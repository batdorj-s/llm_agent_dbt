import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import { readFile, access } from "fs/promises";
import path from "path";
import yaml from "yaml";
import { syncDbtModelsToRag, syncDbtTestResultsToRag, syncDbtMetricsToRag } from "./dbt-sync.js";
import { prompts } from "./agents/prompts.js";
import {
  buildBM25Index,
  hybridSearch,
  bm25Search,
  embedDocuments,
  removeDocumentEmbedding,
  type BM25Index,
} from "./rag/semantic-search.js";

// Self-query cache: avoid redundant LLM calls across agents
const SELF_QUERY_CACHE_MAX = 200;
const selfQueryCache = new Map<string, { result: SelfQueryFilter; expiresAt: number }>();
const SELF_QUERY_CACHE_TTL_MS = 60_000; // 1 minute

// ── RAG Result Cache ──────────────────────────────────────────────────────────
// LRU cache for search results to avoid redundant retrieval pipeline runs
const RAG_RESULT_CACHE_MAX = 500;
const RAG_RESULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
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
  if (Date.now() > entry.expiresAt) {
    ragResultCache.delete(key);
    return null;
  }
  return entry.result;
}

function setRagCachedResult(
  key: string,
  result: { documents: string[][]; metadatas: unknown[][] }
): void {
  // LRU eviction: delete oldest when at capacity
  if (ragResultCache.size >= RAG_RESULT_CACHE_MAX) {
    const oldestKey = ragResultCache.keys().next().value;
    if (oldestKey !== undefined) ragResultCache.delete(oldestKey);
  }
  ragResultCache.set(key, { result, expiresAt: Date.now() + RAG_RESULT_CACHE_TTL_MS });
}

/**
 * Clear all RAG result caches (call after document changes).
 */
export function clearRagResultCache(): void {
  ragResultCache.clear();
}

// ── Query Expansion Cache ─────────────────────────────────────────────────────
// Cache expanded queries to avoid redundant LLM calls
const QUERY_EXPANSION_CACHE_MAX = 300;
const QUERY_EXPANSION_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
interface QueryExpansionCacheEntry {
  expanded: string[];
  expiresAt: number;
}
const queryExpansionCache = new Map<string, QueryExpansionCacheEntry>();

/**
 * Expand a search query using LLM to generate related terms.
 * Returns up to 3 additional search terms that improve recall.
 * Uses cache to avoid redundant LLM calls.
 */
export async function expandQuery(
  originalQuery: string,
  llm?: { invoke?: (input: string) => Promise<{ content?: string }> }
): Promise<string[]> {
  const cacheKey = originalQuery.toLowerCase().trim();
  const cached = queryExpansionCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.expanded;
  }

  if (!llm) {
    // Fallback: simple keyword extraction
    return simpleKeywordExpansion(originalQuery);
  }

  try {
    const prompt = `You are a search query expansion system for a Mongolian financial analytics platform.
Given the user's query, generate exactly 3 alternative search queries that would help find relevant documents.
Return ONLY a JSON array of strings, nothing else.

Original query: "${originalQuery}"

Example output: ["alternative query 1", "alternative query 2", "alternative query 3"]`;

    const response = await llm.invoke?.(prompt);
    const content = response?.content;
    if (typeof content !== "string") return simpleKeywordExpansion(originalQuery);

    // Parse JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return simpleKeywordExpansion(originalQuery);

    const expanded = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(expanded) || expanded.length === 0) {
      return simpleKeywordExpansion(originalQuery);
    }

    // Cache the result
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

/**
 * Generate a hypothetical document that would answer the query (HyDE technique).
 * This helps find documents similar to the ideal answer, not just the query.
 */
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
    if (typeof content === "string" && content.length > 20) {
      return content.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Simple keyword expansion fallback when LLM is unavailable.
 * Extracts meaningful words and generates synonyms/variations.
 */
function simpleKeywordExpansion(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[\s,;.!?]+/)
    .filter(w => w.length > 2);

  // Generate variations: original + word pairs + reversed word pairs
  const expanded: string[] = [];
  if (words.length >= 2) {
    expanded.push(words.join(" "));
    expanded.push(words.slice(0, 2).join(" "));
    if (words.length > 2) {
      expanded.push(words.slice(0, 3).join(" "));
    }
  }
  return expanded;
}

/**
 * Clear query expansion cache.
 */
export function clearQueryExpansionCache(): void {
  queryExpansionCache.clear();
}

// ── Embedding Readiness Gate ──────────────────────────────────────────────────
// Allows callers to wait for embedding completion before searching
let embeddingReadyResolve: (() => void) | null = null;
let embeddingReadyReject: ((err: Error) => void) | null = null;
const embeddingReadyPromise = new Promise<void>((resolve, reject) => {
  embeddingReadyResolve = resolve;
  embeddingReadyReject = reject;
});
let embeddingReady = false;

/**
 * Wait for document embeddings to be ready. Resolves immediately if already done.
 * Useful for search calls that need semantic results.
 */
export async function waitForEmbeddings(timeoutMs: number = 30_000): Promise<boolean> {
  if (embeddingReady) return true;
  try {
    await Promise.race([
      embeddingReadyPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Embedding timeout")), timeoutMs)
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

export interface RagDocument {
  id: string;
  text: string;
  metadata: {
    category: "finance" | "technical" | "business_policy" | "data_catalog" | "previous_analysis";
    department: string;
    author?: string;
    created_at?: string;
    source_name?: string;
    parent_doc_id?: string;
    chunk_index?: number;
    shared?: boolean;
  };
  keywords: string[];
}

export interface SelfQueryFilter {
  query: string;
  categories?: string[];
  departments?: string[];
  author?: string;
  year?: number;
}

export let knowledgeDocuments: RagDocument[] = [];
let bm25Index: BM25Index | null = null;

export const mockDocuments = knowledgeDocuments;

const KNOWLEDGE_BASE_PATH = path.join(process.cwd(), "docs", "knowledge-base.yaml");

export function loadKnowledgeBase(): RagDocument[] {
  try {
    if (!fs.existsSync(KNOWLEDGE_BASE_PATH)) {
      console.warn(`[RAG] Knowledge base file not found at ${KNOWLEDGE_BASE_PATH}`);
      return [];
    }
    const raw = fs.readFileSync(KNOWLEDGE_BASE_PATH, "utf-8");
    const parsed = yaml.parse(raw);
    if (!parsed?.documents || !Array.isArray(parsed.documents)) {
      console.warn("[RAG] No documents found in knowledge-base.yaml");
      return [];
    }
    console.log(`[RAG] Loaded ${parsed.documents.length} documents from knowledge-base.yaml`);
    return parsed.documents as RagDocument[];
  } catch (err) {
    console.warn("[RAG] Failed to load knowledge-base.yaml:", (err as Error).message);
    return [];
  }
}

const ROLE_CATEGORY_MAP: Record<string, string[]> = {
  FinanceAgent: ["finance", "business_policy"],
  TechAgent: ["technical", "data_catalog"],
  DataScientistAgent: ["technical", "data_catalog", "previous_analysis"],
};

function inMemorySearch(query: string, limit: number, categories?: string[], userId?: string) {
  // Use hybrid search if BM25 index is ready
  if (bm25Index && bm25Index.docCount > 0) {
    return hybridSearchSync(query, knowledgeDocuments, bm25Index, limit, categories, userId);
  }
  // Fallback: basic keyword matching (original behavior)
  return legacyKeywordSearch(query, limit, categories, userId);
}

/**
 * Synchronous wrapper around hybrid search for backward compatibility.
 * Uses BM25 only (no async Gemini embeddings) for the in-memory path.
 */
function hybridSearchSync(
  query: string,
  documents: RagDocument[],
  index: BM25Index,
  limit: number,
  categories?: string[],
  userId?: string
): RagDocument[] {
  const results = bm25Search(query, documents, index, limit, categories, userId);
  return results.map(r => r.doc);
}

function legacyKeywordSearch(query: string, limit: number, categories?: string[], userId?: string) {
  const queryWords = query.toLowerCase().split(/\W+/).filter(Boolean);

  let docs = knowledgeDocuments;
  if (userId) {
    docs = docs.filter(d => d.metadata.shared || !d.metadata.author || d.metadata.author === "admin" || d.metadata.author === "system" || d.metadata.author === userId);
  } else {
    // If no userId is specified, only return system/admin documents for security
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

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.doc);
}

function recursiveSearch(query: string, limit: number, categories?: string[], userId?: string): RagDocument[] {
  const results = inMemorySearch(query, limit, categories, userId);

  if (results.length < limit && categories) {
    const queryWords = query.toLowerCase().split(/\W+/).filter(Boolean);
    for (const word of queryWords) {
      if (word.length < 3) continue;
      const extra = inMemorySearch(word, 1, categories, userId);
      for (const doc of extra) {
        if (!results.find(r => r.id === doc.id)) {
          results.push(doc);
        }
      }
      if (results.length >= limit) break;
    }
  }

  return results.slice(0, limit);
}

/**
 * Compute recency score for a document based on created_at.
 * Returns 0-1 where 1 = very recent, 0 = very old.
 * Documents within 30 days get full score, decaying exponentially over 1 year.
 */
function computeRecencyScore(createdAt: string | undefined): number {
  if (!createdAt) return 0.5; // Unknown date gets neutral score
  try {
    const docDate = new Date(createdAt);
    const now = Date.now();
    const ageMs = now - docDate.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays <= 30) return 1.0;
    if (ageDays >= 365) return 0.1;
    // Exponential decay: score = e^(-ageDays/120)
    return Math.exp(-ageDays / 120);
  } catch {
    return 0.5;
  }
}

/**
 * Apply recency weighting to search results.
 * Blends the original score with recency: 85% original + 15% recency.
 */
function applyRecencyWeighting(
  docs: RagDocument[],
  scores: number[]
): Array<{ doc: RagDocument; score: number }> {
  return docs.map((doc, i) => {
    const recency = computeRecencyScore(doc.metadata.created_at);
    const blendedScore = 0.85 * scores[i] + 0.15 * recency;
    return { doc, score: blendedScore };
  });
}

function formatWithSource(docs: RagDocument[]): string {
  return docs.map(doc => {
    const source = doc.metadata.source_name ? `[Source: ${doc.metadata.source_name}]` : "";
    const dept = doc.metadata.department ? `(${doc.metadata.department})` : "";
    return `${source}${dept ? " " + dept : ""}\n${doc.text}`;
  }).join("\n\n---\n\n");
}

/**
 * Estimate token count for mixed Mongolian/English text (~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks with overlap.
 * Uses semantic-aware splitting: prefers paragraph > sentence > character boundaries.
 * Better handles Mongolian text by considering topic coherence.
 */
export function chunkText(
  text: string,
  chunkSize: number = 512,
  overlap: number = 64
): string[] {
  const estimatedTokens = estimateTokens(text);
  if (estimatedTokens <= chunkSize) return [text];

  const chunks: string[] = [];

  // Split into paragraphs first
  const paragraphs = text.split(/\n\s*\n/);
  let current = "";

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);
    const currentTokens = estimateTokens(current);

    if (currentTokens + paraTokens <= chunkSize && current.length > 0) {
      // Merge paragraph into current chunk
      current += "\n\n" + para;
    } else if (currentTokens + paraTokens > chunkSize && current.length > 0) {
      // Current chunk is full, flush it
      chunks.push(current.trim());
      const overlapChars = overlap * 4;
      current = current.length > overlapChars
        ? current.slice(-overlapChars) + "\n\n" + para
        : para;
    } else {
      // Paragraph itself exceeds chunkSize — split by sentences
      if (paraTokens > chunkSize) {
        if (current.trim()) chunks.push(current.trim());
        // Split on sentence boundaries (Mongolian + English punctuation)
        const sentences = para.split(/(?<=[.?!…])\s+/);
        current = "";
        for (const sentence of sentences) {
          const sentenceTokens = estimateTokens(sentence);
          if (sentenceTokens > chunkSize) {
            // Single sentence too long — split by comma/clause
            if (current.trim()) chunks.push(current.trim());
            const clauses = sentence.split(/[,;:]\s*/);
            current = "";
            for (const clause of clauses) {
              const clauseTokens = estimateTokens(clause);
              if (estimateTokens(current + " " + clause) > chunkSize && current.length > 0) {
                chunks.push(current.trim());
                current = clause;
              } else {
                current += (current ? " " : "") + clause;
              }
            }
          } else if (estimateTokens(current + " " + sentence) > chunkSize && current.length > 0) {
            chunks.push(current.trim());
            current = sentence;
          } else {
            current += (current ? " " : "") + sentence;
          }
        }
      } else {
        current = para;
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

let chromaClient: any = null;
let collection: any = null;

async function getChromaCollection() {
  if (collection) return collection;

  const hasChromaUrl = process.env.CHROMA_URL;
  const hasOpenAIKey = process.env.OPENAI_API_KEY &&
    process.env.OPENAI_API_KEY !== "your_openai_api_key_here";

  if (!hasChromaUrl || !hasOpenAIKey) return null;

  try {
    const { ChromaClient, OpenAIEmbeddingFunction } = await import("chromadb") as any;

    chromaClient = new ChromaClient({ path: process.env.CHROMA_URL });

    const embedder = new OpenAIEmbeddingFunction({
      openai_api_key: process.env.OPENAI_API_KEY!,
      openai_model: "text-embedding-3-small",
    });

    collection = await chromaClient.getOrCreateCollection({
      name: "enterprise-kb",
      embeddingFunction: embedder,
      metadata: { "hnsw:space": "cosine" },
    });

    console.log("[VectorDB] ChromaDB collection ready [OK]");
    return collection;
  } catch (err) {
    console.warn("[VectorDB] ChromaDB unavailable, using in-memory fallback:", (err as Error).message);
    return null;
  }
}

function ingestFinanceGlossary(): RagDocument[] {
  const glossaryPath = path.join(process.cwd(), "src", "rag", "finance-glossary.yaml");
  if (!fs.existsSync(glossaryPath)) {
    console.warn("[RAG] Finance glossary not found at", glossaryPath);
    return [];
  }
  const raw = fs.readFileSync(glossaryPath, "utf-8");
  const parsed = yaml.parse(raw);
  if (!parsed?.terms || !Array.isArray(parsed.terms)) return [];

  return parsed.terms.map((term: any, i: number) => ({
    id: `finance-glossary-${i}`,
    text: `${term.term}: ${term.definition}`,
    metadata: {
      category: "finance" as const,
      department: "finance",
      author: "system",
      source_name: "finance-glossary",
      shared: true,
    },
    keywords: [term.term.toLowerCase(), ...(term.tags || [])],
  }));
}

export async function setupKnowledgeBase() {
  // Load knowledge base from YAML first
  const yamlDocs = loadKnowledgeBase();
  knowledgeDocuments.push(...yamlDocs);

  // Load finance glossary (deduplicated by stable id)
  const financeDocs = ingestFinanceGlossary();
  let financeAdded = 0;
  for (const doc of financeDocs) {
    if (!knowledgeDocuments.some(d => d.id === doc.id)) {
      knowledgeDocuments.push(doc);
      financeAdded++;
    }
  }
  if (financeAdded > 0) {
    console.log(`[RAG] Loaded ${financeAdded} finance glossary terms`);
  }

  // Load dbt model definitions as RAG context
  const dbtDocs = syncDbtModelsToRag();
  knowledgeDocuments.push(...dbtDocs);

  // Load dbt test results — failed tests become dbt_warning documents
  const dbtTestDocs = syncDbtTestResultsToRag();
  knowledgeDocuments.push(...dbtTestDocs);

  // Load dbt metrics layer — business metric definitions with column synonyms
  const dbtMetricDocs = syncDbtMetricsToRag();
  knowledgeDocuments.push(...dbtMetricDocs);

  // Load approved feedback from failed_queries.json
  try {
    const failedQueriesPath = path.join(process.cwd(), "logs", "failed_queries.json");
    await access(failedQueriesPath).catch(() => {
      throw new Error("File not found");
    });
    const rawData = await readFile(failedQueriesPath, "utf8");
    const data = JSON.parse(rawData);
    for (const entry of data) {
      if (entry.status === "approved" && entry.response) {
        const ragText = `Failed Query: User asked "${entry.message}". The system responded with: "${entry.response}". This response was rated as incorrect.`;
        if (!knowledgeDocuments.some(d => d.id === entry.id)) {
          knowledgeDocuments.push({
            id: entry.id,
            text: ragText,
            metadata: {
              category: "previous_analysis",
              department: "analytics",
              author: entry.userId || "system",
              created_at: entry.timestamp || new Date().toISOString(),
              source_name: "User Feedback",
              shared: true,
            },
            keywords: ["failed_query", "feedback", ...entry.message.toLowerCase().split(/\W+/).filter(Boolean)],
          });
        }
      }
    }
  } catch (err) {
    console.warn("[RAG] Failed to load approved feedback on startup:", (err as Error).message);
  }

  const col = await getChromaCollection();

  if (col) {
    console.log("Setting up ChromaDB Vector DB...");
    const existing = await col.count();

    if (existing === 0) {
      await col.add({
        ids: knowledgeDocuments.map(d => d.id),
        documents: knowledgeDocuments.map(d => d.text),
        metadatas: knowledgeDocuments.map(d => ({ ...d.metadata, category: d.metadata.category })),
      });
      console.log(`[VectorDB] ChromaDB setup complete. Added ${knowledgeDocuments.length} documents.`);
    } else {
      console.log(`[VectorDB] ChromaDB already contains ${existing} documents.`);
    }
  } else {
    console.log(`[VectorDB] In-Memory DB ready. ${knowledgeDocuments.length} documents loaded.`);
  }

  // Build BM25 index for hybrid search
  if (knowledgeDocuments.length > 0) {
    bm25Index = buildBM25Index(knowledgeDocuments);
    console.log(`[SemanticSearch] BM25 index built: ${bm25Index.docCount} documents, avg length ${Math.round(bm25Index.avgDocLength)} tokens`);
  }

  // Embed documents with Gemini for semantic search (wait for completion to avoid race condition)
  try {
    await embedDocuments(knowledgeDocuments);
    embeddingReady = true;
    embeddingReadyResolve?.();
    console.log("[SemanticSearch] Document embeddings ready — semantic search available");
  } catch (err) {
    console.warn("[SemanticSearch] Document embedding failed (search will use BM25 only):", (err as Error).message);
    // Still mark as ready so searches can proceed with BM25 fallback
    embeddingReady = true;
    embeddingReadyResolve?.();
  }

  return true;
}

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

  // Check RAG result cache first
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

  // ── Query Expansion: generate related terms for better recall ──
  let expandedQueries: string[] = [];
  try {
    expandedQueries = await expandQuery(query);
  } catch {
    // Query expansion is optional; continue with original query
  }
  // Combine original query with expanded queries for multi-query retrieval
  const allQueries = [query, ...expandedQueries.filter(q => q !== query)];

  // ── Try ChromaDB first (single path, no fallthrough duplication) ──
  const col = await getChromaCollection();
  if (col) {
    try {
      const conditions: unknown[] = [
        { category: { "$in": categories } }
      ];
      if (departmentFilter.length > 0) {
        conditions.push({ department: { "$in": departmentFilter } });
      }
      if (userId) {
        conditions.push({
          "$or": [
            { shared: true },
            { author: "admin" },
            { author: "system" },
            { author: userId }
          ]
        });
      } else {
        conditions.push({
          "$or": [
            { shared: true },
            { author: "admin" },
            { author: "system" }
          ]
        });
      }
      const chromaWhere = conditions.length > 1 ? { "$and": conditions } : conditions[0];

      // Multi-query retrieval: search with original + expanded queries
      const chromaResults: Array<{ documents: string[][]; metadatas: unknown[][]; distances: number[][] }> = [];
      for (const q of allQueries.slice(0, 2)) { // Limit to 2 queries to avoid latency
        try {
          const r = await col.query({
            queryTexts: [q],
            nResults: limit * 2,
            where: chromaWhere,
          });
          chromaResults.push(r as { documents: string[][]; metadatas: unknown[][]; distances: number[][] });
        } catch {
          // Skip failed queries
        }
      }

      // Merge and deduplicate results from multiple queries
      const mergedDocs: string[] = [];
      const mergedMetas: Record<string, unknown>[] = [];
      const mergedDistances: number[] = [];
      const seen = new Set<string>();
      for (const results of chromaResults) {
        if (results.documents[0]) {
          for (let i = 0; i < results.documents[0].length; i++) {
            const text = results.documents[0][i];
            const textHash = text.substring(0, 50); // Simple dedup by prefix
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
            // Hybrid score: 0.6 * vector + 0.3 * keyword + 0.1 * recency
            const distance = mergedDistances[i] ?? 0.5;
            const vectorScore = 1 - distance;
            const keywordScore = queryWords.reduce((acc, word) => {
              if (Array.isArray(meta.keywords) && meta.keywords.includes(word)) return acc + 0.3;
              if (text.toLowerCase().includes(word)) return acc + 0.1;
              return acc;
            }, 0);
            const recencyScore = computeRecencyScore(meta.created_at as string | undefined);
            const finalScore = 0.6 * vectorScore + 0.3 * Math.min(keywordScore, 1) + 0.1 * recencyScore;
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
          const result = {
            documents: [formatted],
            metadatas: [topMatches.map(m => m.meta)],
          };
          setRagCachedResult(cacheKey, result);
          return result;
        }
      }
    } catch (err) {
      console.warn("[RAG] ChromaDB query failed, falling back to in-memory:", (err as Error).message);
    }
  }

  // ── In-memory path: hybrid search (Gemini + BM25) when available, else BM25-only ──
  let resultDocs: RagDocument[] = [];

  if (bm25Index && bm25Index.docCount > 0) {
    try {
      const hybridResults = await hybridSearch(
        query, knowledgeDocuments, bm25Index, limit, categories, userId
      );
      if (hybridResults.length > 0) {
        // Apply recency weighting to hybrid results
        const docs = hybridResults.map(r => r.doc);
        const scores = hybridResults.map(r => r.score);
        const weighted = applyRecencyWeighting(docs, scores);
        weighted.sort((a, b) => b.score - a.score);
        resultDocs = weighted.map(w => w.doc);
        console.log(`[RAG] Hybrid search returned ${resultDocs.length} results (semantic+BM25+recency) for ${agentRole}`);
      }
    } catch (err) {
      console.warn("[RAG] Hybrid search failed, falling back to BM25-only:", (err as Error).message);
      // Fall through to BM25-only
      const bm25Results = bm25Search(query, knowledgeDocuments, bm25Index, limit, categories, userId);
      const docs = bm25Results.map(r => r.doc);
      const scores = bm25Results.map(r => r.score);
      const weighted = applyRecencyWeighting(docs, scores);
      weighted.sort((a, b) => b.score - a.score);
      resultDocs = weighted.map(w => w.doc);
    }
  } else {
    // Legacy fallback with recency
    const legacyResults = legacyKeywordSearch(query, limit * 2, categories, userId);
    const scores = legacyResults.map((_, i) => limit * 2 - i); // Ordinal scores
    const weighted = applyRecencyWeighting(legacyResults, scores);
    weighted.sort((a, b) => b.score - a.score);
    resultDocs = weighted.slice(0, limit).map(w => w.doc);
  }

  // Apply post-filters
  if (departmentFilter.length > 0 && resultDocs.length > 0) {
    resultDocs = resultDocs.filter(r => departmentFilter.includes(r.metadata.department));
  }

  if (filter?.year && resultDocs.length > 0) {
    resultDocs = resultDocs.filter(r => {
      if (!r.metadata.created_at) return true;
      return r.metadata.created_at.startsWith(String(filter.year));
    });
  }

  // If filters removed everything, retry without department filter
  if (resultDocs.length === 0 && departmentFilter.length > 0) {
    if (bm25Index && bm25Index.docCount > 0) {
      const retryResults = bm25Search(query, knowledgeDocuments, bm25Index, limit, categories, userId);
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

/**
 * Self-Querying: Uses LLM to extract structured metadata filters from a natural language query.
 * Results are cached for 60s to avoid redundant calls across agents.
 */
export async function selfQueryTransform(
  query: string,
  llmInvoke: (prompt: string) => Promise<string>
): Promise<SelfQueryFilter> {
  // Check cache first
  const cacheKey = query.trim().toLowerCase();
  const cached = selfQueryCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[RAG] Self-query cache hit for "${cacheKey}"`);
    return cached.result;
  }

  const systemPrompt = (prompts.self_query_transform as string).replace(/\{query\}/g, query.replace(/"/g, "'"));

  try {
    const response = await llmInvoke(systemPrompt);
    // Try direct JSON parse first, then regex fallback
    let parsed: any;
    try {
      parsed = JSON.parse(response.trim());
    } catch {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    }

    const result: SelfQueryFilter = {
      query: parsed.query || query,
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      departments: Array.isArray(parsed.departments) ? parsed.departments : [],
      year: typeof parsed.year === "number" ? parsed.year : undefined,
    };

    // Cache the result (evict oldest if at capacity)
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

export async function removeDocumentsByPrefix(idPrefix: string): Promise<number> {
  const before = knowledgeDocuments.length;
  const removedIds: string[] = [];
  knowledgeDocuments = knowledgeDocuments.filter(d => {
    const match = d.id.startsWith(idPrefix);
    if (match) removedIds.push(d.id);
    return !match;
  });
  const removed = before - knowledgeDocuments.length;

  const col = await getChromaCollection();
  if (col && removedIds.length > 0) {
    try {
      await col.delete(removedIds);
      console.log(`[RAG] Deleted ${removedIds.length} ChromaDB docs by id (prefix: ${idPrefix})`);
    } catch (err: unknown) {
      console.warn(`[RAG] ChromaDB delete failed for prefix ${idPrefix}:`, err instanceof Error ? err.message : String(err));
    }
  }

  // Remove from embedding store and rebuild BM25 index
  for (const id of removedIds) {
    removeDocumentEmbedding(id);
  }
  if (removed > 0 && knowledgeDocuments.length > 0) {
    bm25Index = buildBM25Index(knowledgeDocuments);
    console.log(`[SemanticSearch] BM25 index rebuilt after removal: ${bm25Index.docCount} documents`);
  }

  if (removed > 0) {
    console.log(`[RAG] Removed ${removed} documents with id prefix "${idPrefix}"`);
    // Invalidate search result cache since documents changed
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
) {
  const tokenCount = estimateTokens(text);
  if (tokenCount > 8000) {
    console.warn(`[RAG] Document ${id} exceeds 8000 tokens (est. ${tokenCount}). Consider chunking.
`);
  }

  const shouldChunk = !options?.skipChunking && tokenCount > (options?.chunkSize || 512) * 4;

  const chunks = shouldChunk
    ? chunkText(text, options?.chunkSize || 512, 64)
    : [text];

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

  for (const doc of docs) {
    knowledgeDocuments.push(doc);
  }

  console.log(`[RAG] Added ${docs.length} document(s): ${id} (${metadata.category})`);

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

  // Rebuild BM25 index with new documents
  if (knowledgeDocuments.length > 0) {
    bm25Index = buildBM25Index(knowledgeDocuments);
    console.log(`[SemanticSearch] BM25 index rebuilt: ${bm25Index.docCount} documents`);
  }

  // Embed new documents with Gemini (await to ensure availability)
  try {
    await embedDocuments(docs);
  } catch (err) {
    console.warn("[SemanticSearch] New document embedding failed:", (err as Error).message);
  }

  // Invalidate search result cache since documents changed
  clearRagResultCache();
}

/**
 * Retrieves the data passport document for a given table from ChromaDB.
 * Returns null if ChromaDB is unavailable or no passport exists.
 */
export async function getPassportByTableName(tableName: string): Promise<string | null> {
  const col = await getChromaCollection();
  if (!col) return null;
  try {
    const result = await col.get({ ids: [`passport_${tableName}`] });
    return result.documents?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Parses the topBusinessQuestions from a stored data passport markdown string.
 */
export function parsePassportQuestions(passportMarkdown: string): string[] {
  const sectionMatch = passportMarkdown.match(/###\s*Тэргүүлэх 5 бизнесийн асуулт\n([\s\S]*?)(?:\n###|$)/);
  if (!sectionMatch) return [];
  return sectionMatch[1]
    .split("\n")
    .map(line => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}
