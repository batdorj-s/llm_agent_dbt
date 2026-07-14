/**
 * hybrid-search.ts — Hybrid search (ChromaDB + BM25 + recency), self-query, query expansion,
 *                    and document catalog operations.
 */

import { prompts } from "../agents/prompts.js";
import {
  buildBM25Index,
  hybridSearch,
  bm25Search,
  removeDocumentEmbedding,
  embedDocuments,
} from "./semantic-search.js";
import { getChromaCollection } from "./chroma-client.js";
import {
  type RagDocument,
  getKnowledgeDocuments,
  setKnowledgeDocuments,
  addKnowledgeDocuments,
  getBm25Index,
  setBm25Index,
  ROLE_CATEGORY_MAP,
  estimateTokens,
  chunkText,
} from "./knowledge-base.js";

// ── Self-query filter type ────────────────────────────────────

export interface SelfQueryFilter {
  query: string;
  categories?: string[];
  departments?: string[];
  author?: string;
  year?: number;
}

// ── Self-query cache ──────────────────────────────────────────

const SELF_QUERY_CACHE_MAX = 200;
const selfQueryCache = new Map<string, { result: SelfQueryFilter; expiresAt: number }>();
const SELF_QUERY_CACHE_TTL_MS = 60_000;

// ── RAG result cache ──────────────────────────────────────────

const RAG_RESULT_CACHE_MAX = 500;
const RAG_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
interface RagCacheEntry {
  result: { documents: string[][]; metadatas: unknown[][] };
  expiresAt: number;
}
const ragResultCache = new Map<string, RagCacheEntry>();

function makeRagCacheKey(params: {
  query: string;
  agentRole: string;
  limit: number;
  userId?: string;
  filterHash?: string;
}): string {
  const filterStr = params.filterHash || "";
  return `${params.query}::${params.agentRole}::${params.limit}::${params.userId || ""}::${filterStr}`;
}

function getRagCachedResult(key: string): { documents: string[][]; metadatas: unknown[][] } | null {
  const entry = ragResultCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { ragResultCache.delete(key); return null; }
  return entry.result;
}

function setRagCachedResult(
  key: string,
  result: { documents: string[][]; metadatas: unknown[][] }
): void {
  if (ragResultCache.size >= RAG_RESULT_CACHE_MAX) {
    const oldestKey = ragResultCache.keys().next().value;
    if (oldestKey !== undefined) ragResultCache.delete(oldestKey);
  }
  ragResultCache.set(key, { result, expiresAt: Date.now() + RAG_RESULT_CACHE_TTL_MS });
}

export function clearRagResultCache(): void {
  ragResultCache.clear();
}

// ── Query expansion cache ─────────────────────────────────────

const QUERY_EXPANSION_CACHE_MAX = 300;
const QUERY_EXPANSION_CACHE_TTL_MS = 10 * 60 * 1000;
interface QueryExpansionCacheEntry { expanded: string[]; expiresAt: number; }
const queryExpansionCache = new Map<string, QueryExpansionCacheEntry>();

export function clearQueryExpansionCache(): void {
  queryExpansionCache.clear();
}

function simpleKeywordExpansion(query: string): string[] {
  const words = query.toLowerCase().split(/[\s,;.!?]+/).filter(w => w.length > 2);
  const expanded: string[] = [];
  if (words.length >= 2) {
    expanded.push(words.join(" "));
    expanded.push(words.slice(0, 2).join(" "));
    if (words.length > 2) expanded.push(words.slice(0, 3).join(" "));
  }
  return expanded;
}

export async function expandQuery(
  originalQuery: string,
  llm?: { invoke?: (input: string) => Promise<{ content?: string }> }
): Promise<string[]> {
  const cacheKey = originalQuery.toLowerCase().trim();
  const cached = queryExpansionCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.expanded;

  if (!llm) return simpleKeywordExpansion(originalQuery);

  try {
    const prompt = `You are a search query expansion system for a Mongolian financial analytics platform.
Given the user's query, generate exactly 3 alternative search queries that would help find relevant documents.
Return ONLY a JSON array of strings, nothing else.

Original query: "${originalQuery}"

Example output: ["alternative query 1", "alternative query 2", "alternative query 3"]`;

    const response = await llm.invoke?.(prompt);
    const content = response?.content;
    if (typeof content !== "string") return simpleKeywordExpansion(originalQuery);

    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return simpleKeywordExpansion(originalQuery);

    const expanded = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(expanded) || expanded.length === 0) return simpleKeywordExpansion(originalQuery);

    if (queryExpansionCache.size >= QUERY_EXPANSION_CACHE_MAX) {
      const oldestKey = queryExpansionCache.keys().next().value;
      if (oldestKey !== undefined) queryExpansionCache.delete(oldestKey);
    }
    queryExpansionCache.set(cacheKey, {
      expanded: expanded.slice(0, 3),
      expiresAt: Date.now() + QUERY_EXPANSION_CACHE_TTL_MS,
    });

    return expanded.slice(0, 3);
  } catch {
    return simpleKeywordExpansion(originalQuery);
  }
}

export async function generateHypotheticalDocument(
  query: string,
  llm?: { invoke?: (input: string) => Promise<{ content?: string }> }
): Promise<string | null> {
  if (!llm) return null;
  try {
    const prompt = `You are a search optimization system. Generate a short hypothetical document (2-3 sentences) that would contain the answer to this question about a Mongolian business.

Question: "${query}"

Hypothetical answer document:`;

    const response = await llm.invoke?.(prompt);
    const content = response?.content;
    if (typeof content === "string" && content.length > 20) return content.trim();
    return null;
  } catch {
    return null;
  }
}

// ── Recency scoring ───────────────────────────────────────────

function computeRecencyScore(createdAt: string | undefined): number {
  if (!createdAt) return 0.5;
  try {
    const docDate = new Date(createdAt);
    const ageMs = Date.now() - docDate.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays <= 30) return 1.0;
    if (ageDays >= 365) return 0.1;
    return Math.exp(-ageDays / 120);
  } catch {
    return 0.5;
  }
}

const SEMANTIC_WEIGHT = 0.6;
const KEYWORD_WEIGHT = 0.25;
const RECENCY_WEIGHT = 0.15;

function applyRecencyWeighting(
  docs: RagDocument[],
  scores: number[]
): Array<{ doc: RagDocument; score: number }> {
  return docs.map((doc, i) => {
    const recency = computeRecencyScore(doc.metadata.created_at);
    const blendedScore = (SEMANTIC_WEIGHT + KEYWORD_WEIGHT) * scores[i] + RECENCY_WEIGHT * recency;
    return { doc, score: blendedScore };
  });
}

// ── In-memory search helpers ──────────────────────────────────

function legacyKeywordSearch(query: string, limit: number, categories?: string[], userId?: string): RagDocument[] {
  const queryWords = query.toLowerCase().split(/\W+/).filter(Boolean);
  let docs = getKnowledgeDocuments();
  if (userId) {
    docs = docs.filter(d => d.metadata.shared || !d.metadata.author || d.metadata.author === "admin" || d.metadata.author === "system" || d.metadata.author === userId);
  } else {
    docs = docs.filter(d => d.metadata.shared || !d.metadata.author || d.metadata.author === "admin" || d.metadata.author === "system");
  }
  if (categories && categories.length > 0) {
    docs = docs.filter(d => categories.includes(d.metadata.category));
  }
  const scored = docs.map(doc => {
    const score = queryWords.reduce((acc, word) => {
      if (doc.keywords.includes(word)) return acc + 2;
      if (doc.text.toLowerCase().includes(word)) return acc + 1;
      return acc;
    }, 0);
    return { doc, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.doc);
}

function inMemorySearch(query: string, limit: number, categories?: string[], userId?: string): RagDocument[] {
  const idx = getBm25Index();
  if (idx && idx.docCount > 0) {
    const results = bm25Search(query, getKnowledgeDocuments(), idx, limit, categories, userId);
    return results.map(r => r.doc);
  }
  return legacyKeywordSearch(query, limit, categories, userId);
}

function _recursiveSearch(query: string, limit: number, categories?: string[], userId?: string): RagDocument[] {
  const results = inMemorySearch(query, limit, categories, userId);
  if (results.length < limit && categories) {
    const queryWords = query.toLowerCase().split(/\W+/).filter(Boolean);
    for (const word of queryWords) {
      if (word.length < 3) continue;
      const extra = inMemorySearch(word, 1, categories, userId);
      for (const doc of extra) {
        if (!results.find(r => r.id === doc.id)) results.push(doc);
      }
      if (results.length >= limit) break;
    }
  }
  return results.slice(0, limit);
}

/**
 * Format RAG documents with `[Source: name]` markers for citation display.
 */
export function formatRagDocuments(docs: string[], metadatas: unknown[]): string[] {
  return docs.map((text, i) => {
    const meta = (metadatas[i] as Record<string, unknown>) || {};
    const sourceName = (meta.source_name as string) || "";
    const dept = (meta.department as string) || "";
    const prefix = sourceName ? `[Source: ${sourceName}]${dept ? ` (${dept})` : ""}` : "";
    return prefix ? `${prefix}\n${text}` : text;
  });
}

// ── Main search ───────────────────────────────────────────────

export async function searchKnowledgeBase(
  query: string,
  agentRole: string = "FinanceAgent",
  limit: number = 5,
  userId?: string
): Promise<{ documents: string[][]; metadatas: unknown[][] }> {
  return searchKnowledgeBaseWithFilter({ query, agentRole, limit, userId });
}

export async function searchKnowledgeBaseWithFilter(
  params: {
    query: string;
    agentRole?: string;
    limit?: number;
    filter?: SelfQueryFilter;
    userId?: string;
  }
): Promise<{ documents: string[][]; metadatas: unknown[][] }> {
  const { query, agentRole, limit, filter, userId } = {
    agentRole: "FinanceAgent",
    limit: 5,
    ...params
  };
  console.log(`[RAG] Agent="${agentRole}" searching: "${query}"${filter ? ` | self-query: ${JSON.stringify(filter)}` : ""}${userId ? ` | user: ${userId}` : ""}`);

  const filterHash = filter ? JSON.stringify(filter) : "";
  const cacheKey = makeRagCacheKey({ query, agentRole, limit, userId, filterHash });
  const cachedResult = getRagCachedResult(cacheKey);
  if (cachedResult) {
    console.log(`[RAG] Cache hit for query "${query.substring(0, 50)}..."`);
    return cachedResult;
  }

  let categories = ROLE_CATEGORY_MAP[agentRole] || ["finance", "business_policy"];
  if (filter?.categories && filter.categories.length > 0) {
    categories = categories.filter(c => filter.categories!.includes(c));
    if (categories.length === 0) categories = filter.categories;
  }
  const departmentFilter = filter?.departments?.filter(Boolean) || [];

  // Query expansion
  let expandedQueries: string[] = [];
  try { expandedQueries = await expandQuery(query); } catch { /* optional */ }
  const allQueries = [query, ...expandedQueries.filter(q => q !== query)];

  // ── ChromaDB path ──────────────────────────────────────────
  const col = await getChromaCollection();
  if (col) {
    try {
      const conditions: unknown[] = [{ category: { "$in": categories } }];
      if (departmentFilter.length > 0) conditions.push({ department: { "$in": departmentFilter } });
      if (userId) {
        conditions.push({ "$or": [{ shared: true }, { author: "admin" }, { author: "system" }, { author: userId }] });
      } else {
        conditions.push({ "$or": [{ shared: true }, { author: "admin" }, { author: "system" }] });
      }
      const chromaWhere = conditions.length > 1 ? { "$and": conditions } : conditions[0];

      const chromaResults: Array<{ documents: string[][]; metadatas: unknown[][]; distances: number[][] }> = [];
      const queryPromises = allQueries.slice(0, 2).map(async (q) => {
        try {
          const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ChromaDB query timeout")), 3000));
          const r = await Promise.race([
            col.query({ queryTexts: [q], nResults: limit * 2, where: chromaWhere }),
            timeoutPromise,
          ]);
          return r as { documents: string[][]; metadatas: unknown[][]; distances: number[][] };
        } catch { return null; }
      });
      const queryResults = await Promise.all(queryPromises);
      for (const r of queryResults) { if (r) chromaResults.push(r); }

      const mergedDocs: string[] = [];
      const mergedMetas: Record<string, unknown>[] = [];
      const mergedDistances: number[] = [];
      const seen = new Set<string>();
      for (const results of chromaResults) {
        if (results.documents[0]) {
          for (let i = 0; i < results.documents[0].length; i++) {
            const text = results.documents[0][i];
            const textHash = text.substring(0, 50);
            if (!seen.has(textHash)) {
              seen.add(textHash);
              mergedDocs.push(text);
              mergedMetas.push((results.metadatas[0]?.[i] || {}) as Record<string, unknown>);
              mergedDistances.push(results.distances?.[0]?.[i] ?? 0.5);
            }
          }
        }
      }
      console.log(`[RAG] ChromaDB returned ${mergedDocs.length} results (from ${allQueries.length} queries)`);
      if (mergedDocs.length > 0) {
        const matched: Array<{ text: string; meta: Record<string, unknown>; score: number }> = [];
        const queryWords = query.toLowerCase().split(/\W+/).filter(Boolean);
        mergedDocs.forEach((text: string, i: number) => {
          const meta = mergedMetas[i] as Record<string, unknown>;
          const author = meta.author;
          const shared = meta.shared === true;
          const allowed = shared || (userId
            ? (!author || author === "admin" || author === "system" || author === userId)
            : (!author || author === "admin" || author === "system"));
          if (allowed) {
            const distance = mergedDistances[i] ?? 0.5;
            const vectorScore = 1 - distance;
            const keywordScore = queryWords.reduce((acc, word) => {
              if (Array.isArray(meta.keywords) && meta.keywords.includes(word)) return acc + 0.3;
              if (text.toLowerCase().includes(word)) return acc + 0.1;
              return acc;
            }, 0);
            const recencyScore = computeRecencyScore(meta.created_at as string | undefined);
            const finalScore = SEMANTIC_WEIGHT * vectorScore + KEYWORD_WEIGHT * Math.min(keywordScore, 1) + RECENCY_WEIGHT * recencyScore;
            matched.push({ text, meta: meta as Record<string, unknown>, score: finalScore });
          }
        });
        matched.sort((a, b) => b.score - a.score);
        const topMatches = matched.slice(0, limit);
        if (topMatches.length > 0) {
          const formatted = topMatches.map(m => {
            const source = m.meta.source_name ? `[Source: ${m.meta.source_name}]` : "";
            const dept = m.meta.department ? `(${m.meta.department})` : "";
            return `${source}${dept ? " " + dept : ""}\n${m.text}`;
          });
          const result = { documents: [formatted], metadatas: [topMatches.map(m => m.meta)] };
          setRagCachedResult(cacheKey, result);
          return result;
        }
      }
    } catch (err) {
      console.warn("[RAG] ChromaDB query failed, falling back to in-memory:", (err as Error).message);
    }
  }

  // ── In-memory path ─────────────────────────────────────────
  let resultDocs: RagDocument[] = [];

  const idx = getBm25Index();
  if (idx && idx.docCount > 0) {
    try {
      const hybridResults = await hybridSearch(query, getKnowledgeDocuments(), idx, limit, categories, userId);
      if (hybridResults.length > 0) {
        const docs = hybridResults.map(r => r.doc);
        const scores = hybridResults.map(r => r.score);
        const weighted = applyRecencyWeighting(docs, scores);
        weighted.sort((a, b) => b.score - a.score);
        resultDocs = weighted.map(w => w.doc);
        console.log(`[RAG] Hybrid search returned ${resultDocs.length} results (semantic+BM25+recency) for ${agentRole}`);
      }
    } catch (err) {
      console.warn("[RAG] Hybrid search failed, falling back to BM25-only:", (err as Error).message);
      const bm25Results = bm25Search(query, getKnowledgeDocuments(), idx, limit, categories, userId);
      const docs = bm25Results.map(r => r.doc);
      const scores = bm25Results.map(r => r.score);
      const weighted = applyRecencyWeighting(docs, scores);
      weighted.sort((a, b) => b.score - a.score);
      resultDocs = weighted.map(w => w.doc);
    }
  } else {
    const legacyResults = legacyKeywordSearch(query, limit * 2, categories, userId);
    const scores = legacyResults.map((_, i) => limit * 2 - i);
    const weighted = applyRecencyWeighting(legacyResults, scores);
    weighted.sort((a, b) => b.score - a.score);
    resultDocs = weighted.slice(0, limit).map(w => w.doc);
  }

  // Post-filters
  if (departmentFilter.length > 0 && resultDocs.length > 0) {
    resultDocs = resultDocs.filter(r => departmentFilter.includes(r.metadata.department));
  }
  if (filter?.year && resultDocs.length > 0) {
    resultDocs = resultDocs.filter(r => {
      if (!r.metadata.created_at) return true;
      return r.metadata.created_at.startsWith(String(filter.year));
    });
  }
  if (resultDocs.length === 0 && departmentFilter.length > 0) {
    const retryIdx = getBm25Index();
    if (retryIdx && retryIdx.docCount > 0) {
      const retryResults = bm25Search(query, getKnowledgeDocuments(), retryIdx, limit, categories, userId);
      resultDocs = retryResults.map(r => r.doc);
    } else {
      resultDocs = legacyKeywordSearch(query, limit, categories, userId);
    }
  }

  const result = {
    documents: [resultDocs.map(r => r.text)],
    metadatas: [resultDocs.map(r => r.metadata)],
  };
  setRagCachedResult(cacheKey, result);
  console.log(`[RAG] Returning ${resultDocs.length} results for ${agentRole}`);
  return result;
}

// ── Self-query transform ──────────────────────────────────────

export async function selfQueryTransform(
  query: string,
  llmInvoke: (prompt: string) => Promise<string>
): Promise<SelfQueryFilter> {
  const cacheKey = query.trim().toLowerCase();
  const cached = selfQueryCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[RAG] Self-query cache hit for "${cacheKey}"`);
    return cached.result;
  }

  const systemPrompt = (prompts.self_query_transform as string).replace(/\{query\}/g, query.replace(/"/g, "'"));

  try {
    const response = await llmInvoke(systemPrompt);
    let parsed: any;
    try {
      parsed = JSON.parse(response.trim());
    } catch {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      else throw new Error("No JSON found in response");
    }

    const result: SelfQueryFilter = {
      query: parsed.query || query,
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      departments: Array.isArray(parsed.departments) ? parsed.departments : [],
      year: typeof parsed.year === "number" ? parsed.year : undefined,
    };

    if (selfQueryCache.size >= SELF_QUERY_CACHE_MAX) {
      const oldestKey = selfQueryCache.keys().next().value;
      if (oldestKey) selfQueryCache.delete(oldestKey);
    }
    selfQueryCache.set(cacheKey, { result, expiresAt: Date.now() + SELF_QUERY_CACHE_TTL_MS });
    return result;
  } catch (err) {
    console.warn("[RAG] Self-query transform failed:", (err as Error).message);
  }
  return { query };
}

// ── Document catalog operations ───────────────────────────────

export async function removeDocumentsByPrefix(idPrefix: string): Promise<number> {
  const docs = getKnowledgeDocuments();
  const before = docs.length;
  const removedIds: string[] = [];
  setKnowledgeDocuments(docs.filter(d => {
    const match = d.id.startsWith(idPrefix);
    if (match) removedIds.push(d.id);
    return !match;
  }));
  const removed = before - getKnowledgeDocuments().length;

  const col = await getChromaCollection();
  if (col && removedIds.length > 0) {
    try {
      await col.delete(removedIds);
      console.log(`[RAG] Deleted ${removedIds.length} ChromaDB docs by id (prefix: ${idPrefix})`);
    } catch (err: unknown) {
      console.warn(`[RAG] ChromaDB delete failed for prefix ${idPrefix}:`, err instanceof Error ? err.message : String(err));
    }
  }

  for (const id of removedIds) removeDocumentEmbedding(id);

  if (removed > 0 && getKnowledgeDocuments().length > 0) {
    setBm25Index(buildBM25Index(getKnowledgeDocuments()));
    console.log(`[SemanticSearch] BM25 index rebuilt after removal: ${getBm25Index()?.docCount} documents`);
  }

  if (removed > 0) {
    console.log(`[RAG] Removed ${removed} documents with id prefix "${idPrefix}"`);
    clearRagResultCache();
  }
  return removed;
}

export async function addDocumentToCatalog(
  id: string,
  text: string,
  metadata: {
    category: "finance" | "technical" | "business_policy" | "data_catalog" | "previous_analysis";
    department?: string;
    author?: string;
    source_name?: string;
    shared?: boolean;
  },
  keywords: string[],
  options?: { chunkSize?: number; skipChunking?: boolean }
): Promise<void> {
  const tokenCount = estimateTokens(text);
  if (tokenCount > 8000) {
    console.warn(`[RAG] Document ${id} exceeds 8000 tokens (est. ${tokenCount}). Consider chunking.`);
  }

  const shouldChunk = !options?.skipChunking && tokenCount > (options?.chunkSize || 512) * 4;
  const chunks = shouldChunk ? chunkText(text, options?.chunkSize || 512, 64) : [text];

  const docs: RagDocument[] = chunks.map((chunk, i) => ({
    id: chunks.length > 1 ? `${id}_chunk${i}` : id,
    text: chunk,
    metadata: {
      category: metadata.category,
      department: metadata.department || "general",
      author: metadata.author || "system",
      created_at: new Date().toISOString(),
      source_name: metadata.source_name || `Upload: ${id}`,
      parent_doc_id: chunks.length > 1 ? id : undefined,
      chunk_index: chunks.length > 1 ? i : undefined,
      shared: metadata.shared,
    },
    keywords,
  }));

  addKnowledgeDocuments(docs);
  console.log(`[RAG] Added ${docs.length} document(s): ${id} (${metadata.category})`);

  // Rebuild BM25 index
  if (getKnowledgeDocuments().length > 0) {
    setBm25Index(buildBM25Index(getKnowledgeDocuments()));
    console.log(`[SemanticSearch] BM25 index rebuilt: ${getBm25Index()?.docCount} documents`);
  }

  const col = await getChromaCollection();
  if (col) {
    try {
      await col.add({
        ids: docs.map(d => d.id),
        documents: docs.map(d => d.text),
        metadatas: docs.map(d => ({ ...d.metadata, category: d.metadata.category })),
      });
      console.log(`[RAG] Successfully added ${docs.length} chunk(s) to ChromaDB [OK]`);
    } catch (err: unknown) {
      console.error(`[RAG] Failed to add ${id} to ChromaDB:`, err instanceof Error ? err.message : String(err));
    }
  }

  try { await embedDocuments(docs); } catch (err) {
    console.warn("[SemanticSearch] New document embedding failed:", (err as Error).message);
  }

  clearRagResultCache();
}

// ── Passport helpers ──────────────────────────────────────────

export async function getPassportByTableName(tableName: string): Promise<string | null> {
  const col = await getChromaCollection();
  if (!col) return null;
  try {
    const result = await col.get({ ids: [`passport_${tableName}`] });
    return result.documents?.[0] ?? null;
  } catch { return null; }
}

export function parsePassportQuestions(passportMarkdown: string): string[] {
  const sectionMatch = passportMarkdown.match(/###\s*Тэргүүлэх 5 бизнесийн асуулт\n([\s\S]*?)(?:\n###|$)/);
  if (!sectionMatch) return [];
  return sectionMatch[1]
    .split("\n")
    .map(line => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}
