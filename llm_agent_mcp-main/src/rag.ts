import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import path from "path";
import yaml from "yaml";
import { syncDbtModelsToRag, syncDbtTestResultsToRag, syncDbtMetricsToRag } from "./dbt-sync.js";
import {
  buildBM25Index,
  hybridSearch,
  bm25Search,
  embedDocuments,
  removeDocumentEmbedding,
  type BM25Index,
} from "./rag/semantic-search.js";

// Self-query cache: avoid redundant LLM calls across agents
const selfQueryCache = new Map<string, { result: SelfQueryFilter; expiresAt: number }>();
const SELF_QUERY_CACHE_TTL_MS = 60_000; // 1 minute

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
 * Splits on newlines/paragraphs when possible, falls back to character boundary.
 */
export function chunkText(
  text: string,
  chunkSize: number = 512,
  overlap: number = 64
): string[] {
  if (text.length <= chunkSize * 4) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let current = "";

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);
    const currentTokens = estimateTokens(current);

    if (currentTokens + paraTokens <= chunkSize && current.length > 0) {
      current += "\n\n" + para;
    } else if (currentTokens + paraTokens > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      // overlap: take last ~overlap tokens worth of text
      const overlapChars = overlap * 4;
      current = current.length > overlapChars
        ? current.slice(-overlapChars) + "\n\n" + para
        : para;
    } else {
      // Paragraph itself exceeds chunkSize — split by sentences
      if (paraTokens > chunkSize) {
        if (current.trim()) chunks.push(current.trim());
        const sentences = para.split(/(?<=[.?!])\s+/);
        current = "";
        for (const sentence of sentences) {
          if (estimateTokens(current + " " + sentence) > chunkSize && current.length > 0) {
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
    if (fs.existsSync(failedQueriesPath)) {
      const data = JSON.parse(fs.readFileSync(failedQueriesPath, "utf8"));
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

  // Embed documents with Gemini for semantic search (async, non-blocking)
  embedDocuments(knowledgeDocuments).catch(err => {
    console.warn("[SemanticSearch] Document embedding failed (search will use BM25 only):", (err as Error).message);
  });

  return true;
}

export async function searchKnowledgeBase(
  query: string,
  agentRole: string = "FinanceAgent",
  limit: number = 5,
  userId?: string
): Promise<{ documents: string[][]; metadatas: any[][] }> {
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
): Promise<{ documents: string[][]; metadatas: any[][] }> {
  const { query, agentRole, limit, filter, userId } = {
    agentRole: "FinanceAgent",
    limit: 5,
    ...params
  };
  console.log(`[RAG] Agent="${agentRole}" searching: "${query}"${filter ? ` | self-query: ${JSON.stringify(filter)}` : ""}${userId ? ` | user: ${userId}` : ""}`);

  let categories = ROLE_CATEGORY_MAP[agentRole] || ["finance", "business_policy"];

  if (filter?.categories && filter.categories.length > 0) {
    categories = categories.filter(c => filter.categories!.includes(c));
    if (categories.length === 0) categories = filter.categories;
  }
  const departmentFilter = filter?.departments?.filter(Boolean) || [];

  const col = await getChromaCollection();

  if (col) {
    try {
      const conditions: any[] = [
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

      const results = await col.query({
        queryTexts: [query],
        nResults: limit * 3,
        where: chromaWhere,
      });
      console.log(`[RAG] ChromaDB returned ${results.documents[0]?.length || 0} results`);
      if (results.documents[0]?.length > 0) {
        let matched: any[] = [];
        const queryWords = query.toLowerCase().split(/\W+/).filter(Boolean);
        results.documents[0].forEach((text: string, i: number) => {
          const meta = results.metadatas[0][i] || {};
          const author = meta.author;
          const shared = meta.shared === true;
          const allowed = shared || (userId
            ? (!author || author === "admin" || author === "system" || author === userId)
            : (!author || author === "admin" || author === "system"));
          if (allowed) {
            // Hybrid score: 0.7 * vector (distance) + 0.3 * keyword relevance
            const distance = results.distances?.[0]?.[i] ?? 0.5;
            const vectorScore = 1 - distance; // cosine distance → similarity (higher = better)
            const keywordScore = queryWords.reduce((acc, word) => {
              if (meta.keywords?.includes?.(word)) return acc + 0.3;
              if (text.toLowerCase().includes(word)) return acc + 0.1;
              return acc;
            }, 0);
            matched.push({ text, meta, score: 0.7 * vectorScore + 0.3 * Math.min(keywordScore, 1) });
          }
        });

        matched.sort((a, b) => b.score - a.score);
        matched = matched.slice(0, limit);

        if (matched.length > 0) {
          const formatted = matched.map(m => {
            const source = m.meta.source_name ? `[Source: ${m.meta.source_name}]` : "";
            const dept = m.meta.department ? `(${m.meta.department})` : "";
            return `${source}${dept ? " " + dept : ""}\n${m.text}`;
          });
          return {
            documents: [formatted],
            metadatas: [matched.map(m => m.meta)],
          };
        }
      }
    } catch (err) {
      console.warn("[RAG] ChromaDB query failed, falling back to in-memory:", (err as Error).message);
    }
  }

  let results = recursiveSearch(query, limit, categories, userId);

  if (departmentFilter.length > 0 && results.length > 0) {
    results = results.filter(r => departmentFilter.includes(r.metadata.department));
  }

  if (filter?.year && results.length > 0) {
    results = results.filter(r => {
      if (!r.metadata.created_at) return true;
      return r.metadata.created_at.startsWith(String(filter.year));
    });
  }

  if (results.length === 0 && departmentFilter.length > 0) {
    results = recursiveSearch(query, limit, categories, userId);
  }

  // Attempt async hybrid search with Gemini embeddings for better results
  if (bm25Index && bm25Index.docCount > 0) {
    try {
      const hybridResults = await hybridSearch(
        query, knowledgeDocuments, bm25Index, limit, categories, userId
      );
      if (hybridResults.length > 0) {
        const hybridDocs = hybridResults.map(r => r.doc);
        console.log(`[RAG] Hybrid search returned ${hybridDocs.length} results (semantic+BM25) for ${agentRole}`);
        return {
          documents: [hybridDocs.map(r => r.text)],
          metadatas: [hybridDocs.map(r => r.metadata)],
        };
      }
    } catch (err) {
      console.warn("[RAG] Hybrid search failed, falling back to keyword:", (err as Error).message);
    }
  }

  const docs = formatWithSource(results);
  console.log(`[RAG] In-memory returned ${results.length} results for ${agentRole}`);

  return {
    documents: [results.map(r => r.text)],
    metadatas: [results.map(r => r.metadata)],
  };
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

  const systemPrompt = `Extract search filters from the user's query. Return ONLY a JSON object with these fields:
- "query": the core search query (remove date/year references, keep the main subject)
- "categories": array of relevant categories from: finance, technical, business_policy, data_catalog, previous_analysis
- "departments": array of relevant departments if mentioned (e.g. sales, engineering, analytics, security, retention)
- "year": 4-digit year if a specific year is mentioned, or null

Examples:
Input: "2024 оны маркетингийн тайланг харуул"
Output: {"query":"маркетингийн тайлан","categories":["finance","business_policy"],"departments":[],"year":2024}

Input: "SQL бичихдээ ILIKE хэрхэн ашиглах вэ"
Output: {"query":"ILIKE SQL usage","categories":["technical"],"departments":["engineering"],"year":null}

Input: "Борлуулалтын KPI ямар байна"
Output: {"query":"sales KPI","categories":["finance"],"departments":["sales"],"year":null}

If unsure, return: {"query":"${query.replace(/"/g, "'")}","categories":[],"departments":[],"year":null}
Respond with ONLY valid JSON. No markdown, no explanation, no code fences.`;

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

    // Cache the result
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
    } catch (err: any) {
      console.warn(`[RAG] ChromaDB delete failed for prefix ${idPrefix}:`, err.message);
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
    } catch (err: any) {
      console.error(`[RAG] Failed to add ${id} to ChromaDB:`, err.message);
    }
  }

  // Rebuild BM25 index with new documents
  if (knowledgeDocuments.length > 0) {
    bm25Index = buildBM25Index(knowledgeDocuments);
    console.log(`[SemanticSearch] BM25 index rebuilt: ${bm25Index.docCount} documents`);
  }

  // Embed new documents with Gemini
  embedDocuments(docs).catch(err => {
    console.warn("[SemanticSearch] New document embedding failed:", (err as Error).message);
  });
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
