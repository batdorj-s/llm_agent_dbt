/**
 * semantic-search.ts — Hybrid Semantic Search (Gemini Embedding + BM25)
 *
 * Combines:
 *  1. BM25 keyword scoring — fast, no API calls, exact term matching
 *  2. Gemini text-embedding-004 — deep semantic understanding
 *  3. Hybrid scoring — weighted combination for best results
 *
 * Falls back gracefully when Gemini API is unavailable.
 */

import type { RagDocument } from "../rag.js";

// ── Configuration ──────────────────────────────────────────────────────────────

const BM25_K1 = 1.5;
const BM25_B = 0.75;
export const SEMANTIC_WEIGHT = 0.6;
export const BM25_WEIGHT = 0.4;
const EMBEDDING_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const EMBEDDING_CACHE_MAX_ENTRIES = 500;

// ── Tokenizer ──────────────────────────────────────────────────────────────────

/**
 * Tokenize text for BM25. Handles Mongolian Cyrillic + English.
 * Lowercases, splits on non-word chars, filters short tokens.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.\-;:!?\[\](){}'"«»–—…”“‘’'`]+/)
    .filter(t => t.length >= 2);
}

// ── BM25 Scoring ──────────────────────────────────────────────────────────────

export interface BM25Index {
  docLengths: number[];
  avgDocLength: number;
  docCount: number;
  /** term → Set of doc indices containing that term */
  termDocFreq: Map<string, Set<number>>;
  /** term → Map<docIndex, termCountInDoc> */
  termFreqs: Map<string, Map<number, number>>;
}

/**
 * Build BM25 index from documents. Call once, reuse for multiple queries.
 */
export function buildBM25Index(documents: RagDocument[]): BM25Index {
  const docLengths: number[] = [];
  const termDocFreq = new Map<string, Set<number>>();
  const termFreqs = new Map<string, Map<number, number>>();
  let totalLength = 0;

  for (let i = 0; i < documents.length; i++) {
    const tokens = tokenize(documents[i].text);
    // Also include keywords for better matching
    const keywordTokens = (documents[i].keywords || []).map(k => k.toLowerCase());
    const allTokens = [...tokens, ...keywordTokens];
    docLengths.push(allTokens.length);
    totalLength += allTokens.length;

    const freq = new Map<string, number>();
    for (const token of allTokens) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }

    for (const [term, count] of freq) {
      if (!termDocFreq.has(term)) termDocFreq.set(term, new Set());
      termDocFreq.get(term)!.add(i);

      if (!termFreqs.has(term)) termFreqs.set(term, new Map());
      termFreqs.get(term)!.set(i, count);
    }
  }

  return {
    docLengths,
    avgDocLength: totalLength / Math.max(documents.length, 1),
    docCount: documents.length,
    termDocFreq,
    termFreqs,
  };
}

/**
 * Score a query against the BM25 index. Returns scores per document index.
 */
export function bm25Score(
  query: string,
  index: BM25Index
): number[] {
  const queryTokens = tokenize(query);
  const scores = new Array<number>(index.docCount).fill(0);

  for (const term of queryTokens) {
    const docsWithTerm = index.termDocFreq.get(term);
    if (!docsWithTerm || docsWithTerm.size === 0) continue;

    const df = docsWithTerm.size;
    const idf = Math.log((index.docCount - df + 0.5) / (df + 0.5) + 1);

    for (const docIdx of docsWithTerm) {
      const tf = index.termFreqs.get(term)?.get(docIdx) || 0;
      const docLen = index.docLengths[docIdx];
      const numerator = tf * (BM25_K1 + 1);
      const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / index.avgDocLength));
      scores[docIdx] += idf * (numerator / denominator);
    }
  }

  return scores;
}

// ── Gemini Embedding ───────────────────────────────────────────────────────────

let geminiEmbedder: any = null;
let embedderInitAttempted = false;
let embedderLastFailTime = 0;
const EMBEDDER_RETRY_COOLDOWN_MS = 30_000; // 30 секундын дараа дахин оролдоно
const EMBEDDER_MAX_RETRIES = 3;
let embedderRetryCount = 0;

async function getGeminiEmbedder(): Promise<any> {
  // Амжилтгүй болсон бол retry cooldown хүлээх
  if (!geminiEmbedder && embedderInitAttempted) {
    const now = Date.now();
    if (embedderRetryCount >= EMBEDDER_MAX_RETRIES) {
      return null; // Макс retry хүрсэн
    }
    if (now - embedderLastFailTime < EMBEDDER_RETRY_COOLDOWN_MS) {
      return null; // Хүлээх хугацаа дуулаагүй
    }
    // Retry боломжтой — flag-ийг reset хийх
    embedderInitAttempted = false;
  }

  if (embedderInitAttempted) return geminiEmbedder;
  embedderInitAttempted = true;

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey || apiKey.startsWith("your_")) {
    console.log("[SemanticSearch] GOOGLE_API_KEY not set — Gemini embeddings disabled");
    return null;
  }

  try {
    const { GoogleGenerativeAIEmbeddings } = await import("@langchain/google-genai");
    const modelName = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
    geminiEmbedder = new GoogleGenerativeAIEmbeddings({
      apiKey,
      modelName,
    });
    console.log(`[SemanticSearch] Gemini embedding model ready: ${modelName}`);
    embedderRetryCount = 0; // Амжилттай бол retry тоог цэвэрлэх
    return geminiEmbedder;
  } catch (err) {
    console.warn("[SemanticSearch] Failed to init Gemini embeddings:", (err as Error).message);
    embedderLastFailTime = Date.now();
    embedderRetryCount++;
    embedderInitAttempted = false; // Retry боломжтой болгох
    return null;
  }
}

// ── Embedding Cache ────────────────────────────────────────────────────────────

interface CacheEntry {
  embedding: number[];
  expiresAt: number;
}

const queryEmbeddingCache = new Map<string, CacheEntry>();
const docEmbeddingStore = new Map<string, { embedding: number[]; text: string }>();

function cacheKey(text: string): string {
  // Богино query-г (< 100 тэмдэгт) шууд cache key болгох — collision багасгана
  if (text.length < 100) return text;
  // Урт query-г hash ашиглах — FNV-1a hash (Java-style-ээс илүү тархалттай)
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return `fnv_${hash.toString(16)}_${text.length}`;
}

function getCachedQueryEmbedding(query: string): number[] | null {
  const key = cacheKey(query);
  const entry = queryEmbeddingCache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.embedding;
  if (entry) queryEmbeddingCache.delete(key);
  return null;
}

function cacheQueryEmbedding(query: string, embedding: number[]): void {
  // Evict oldest entries if at capacity
  if (queryEmbeddingCache.size >= EMBEDDING_CACHE_MAX_ENTRIES) {
    const oldest = queryEmbeddingCache.keys().next().value;
    if (oldest !== undefined) queryEmbeddingCache.delete(oldest);
  }
  queryEmbeddingCache.set(cacheKey(query), {
    embedding,
    expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS,
  });
}

// ── Embedding Operations ───────────────────────────────────────────────────────

/**
 * Get embedding for a single query string. Uses cache when available.
 */
export async function embedQuery(query: string): Promise<number[] | null> {
  const cached = getCachedQueryEmbedding(query);
  if (cached) return cached;

  const embedder = await getGeminiEmbedder();
  if (!embedder) return null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Gemini embed timeout")), 8000)
    );
    const embedding = await Promise.race([
      embedder.embedQuery(query),
      timeoutPromise,
    ]);
    cacheQueryEmbedding(query, embedding);
    return embedding;
  } catch (err) {
    console.warn("[SemanticSearch] Query embedding failed:", (err as Error).message);
    return null;
  }
}

/**
 * Embed and store documents in the in-memory vector store.
 * Batches API calls to avoid rate limits.
 */
export async function embedDocuments(documents: RagDocument[]): Promise<void> {
  const embedder = await getGeminiEmbedder();
  if (!embedder) return;

  const BATCH_SIZE = 50;
  let embedded = 0;

  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);

    // Skip already-embedded docs
    const toEmbed = batch.filter(d => !docEmbeddingStore.has(d.id));
    if (toEmbed.length === 0) continue;

    try {
      const texts = toEmbed.map(d => d.text);
      const embeddings = await embedder.embedDocuments(texts);

      for (let j = 0; j < toEmbed.length; j++) {
        docEmbeddingStore.set(toEmbed[j].id, {
          embedding: embeddings[j],
          text: toEmbed[j].text,
        });
      }
      embedded += toEmbed.length;

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < documents.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    } catch (err) {
      console.warn(`[SemanticSearch] Batch embedding failed (batch ${i}/${documents.length}):`, (err as Error).message);
      // Continue with next batch — partial embeddings are still useful
    }
  }

  if (embedded > 0) {
    console.log(`[SemanticSearch] Embedded ${embedded} documents into vector store`);
  }
}

/**
 * Remove a document from the embedding store.
 */
export function removeDocumentEmbedding(docId: string): void {
  docEmbeddingStore.delete(docId);
}

// ── Cosine Similarity ──────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Semantic Search (Vector) ───────────────────────────────────────────────────

interface SemanticResult {
  index: number;
  score: number;
}

/**
 * Find most similar documents using Gemini embeddings.
 * Returns indices into the documents array with similarity scores.
 */
export async function semanticSearch(
  query: string,
  documentIds: string[],
  limit: number
): Promise<SemanticResult[]> {
  const queryEmbedding = await embedQuery(query);
  if (!queryEmbedding) return [];

  const results: SemanticResult[] = [];

  for (let i = 0; i < documentIds.length; i++) {
    const docEntry = docEmbeddingStore.get(documentIds[i]);
    if (!docEntry) continue;

    const sim = cosineSimilarity(queryEmbedding, docEntry.embedding);
    if (sim > 0) {
      results.push({ index: i, score: sim });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ── Hybrid Search ──────────────────────────────────────────────────────────────

export interface HybridSearchResult {
  doc: RagDocument;
  score: number;
  semanticScore: number;
  bm25Score: number;
}

/**
 * Normalize scores to [0, 1] range using min-max normalization.
 * Returns 0 for all entries if no positive scores exist.
 */
function normalizeScores(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const hasPositive = scores.some(s => s > 0);
  if (!hasPositive) return scores.map(() => 0); // All zeros → all stay zero
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;
  if (range === 0) return scores.map(() => 1);
  return scores.map(s => (s - min) / range);
}

/**
 * Main hybrid search function.
 * Combines BM25 keyword scoring with Gemini semantic similarity.
 *
 * @param query - The search query
 * @param documents - The documents to search
 * @param bm25Index - Pre-built BM25 index
 * @param limit - Maximum results to return
 * @param categories - Optional category filter
 * @param userId - Optional user ID for access control
 * @param alpha - Semantic weight (0-1). Default 0.6. Higher = more semantic.
 */
export async function hybridSearch(
  query: string,
  documents: RagDocument[],
  bm25Index: BM25Index,
  limit: number = 5,
  categories?: string[],
  userId?: string,
  alpha: number = SEMANTIC_WEIGHT
): Promise<HybridSearchResult[]> {
  // Step 1: Filter documents by access control and categories
  let filteredIndices: number[] = [];
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];

    // Access control
    if (userId) {
      const allowed = doc.metadata.shared ||
        !doc.metadata.author ||
        doc.metadata.author === "admin" ||
        doc.metadata.author === "system" ||
        doc.metadata.author === userId;
      if (!allowed) continue;
    } else {
      const allowed = doc.metadata.shared ||
        !doc.metadata.author ||
        doc.metadata.author === "admin" ||
        doc.metadata.author === "system";
      if (!allowed) continue;
    }

    // Category filter
    if (categories && categories.length > 0) {
      if (!categories.includes(doc.metadata.category)) continue;
    }

    filteredIndices.push(i);
  }

  if (filteredIndices.length === 0) return [];

  // Step 2: BM25 scoring on all documents
  const allBM25Scores = bm25Score(query, bm25Index);

  // Step 3: Semantic scoring via Gemini embeddings
  const filteredDocIds = filteredIndices.map(i => documents[i].id);
  const semanticResults = await semanticSearch(query, filteredDocIds, limit * 3);
  const semanticMap = new Map<number, number>(); // filteredIndex → score
  for (const sr of semanticResults) {
    const originalIndex = filteredIndices[sr.index];
    if (originalIndex !== undefined) {
      semanticMap.set(originalIndex, sr.score);
    }
  }

  // Step 4: Combine scores
  const results: HybridSearchResult[] = [];

  for (const idx of filteredIndices) {
    const bm25 = allBM25Scores[idx] || 0;
    const semantic = semanticMap.get(idx) || 0;
    results.push({
      doc: documents[idx],
      score: 0, // Will be computed after normalization
      semanticScore: semantic,
      bm25Score: bm25,
    });
  }

  // Step 5: Combine scores
  // Separate docs with BM25 matches from those without
  const bm25Matched = results.filter(r => r.bm25Score > 0);
  const bm25Unmatched = results.filter(r => r.bm25Score === 0);

  // Normalize only BM25-matched docs (avoid inflating unmatched doc scores)
  if (bm25Matched.length > 0) {
    const bm25Values = normalizeScores(bm25Matched.map(r => r.bm25Score));
    const semanticValues = normalizeScores(bm25Matched.map(r => r.semanticScore));
    const hasSemanticData = semanticValues.some(v => v > 0);
    const effectiveAlpha = hasSemanticData ? alpha : 0;

    for (let i = 0; i < bm25Matched.length; i++) {
      bm25Matched[i].score =
        effectiveAlpha * semanticValues[i] +
        (1 - effectiveAlpha) * bm25Values[i];
    }
  }

  // Unmatched docs get raw semantic score (no BM25 component)
  for (const r of bm25Unmatched) {
    r.score = r.semanticScore;
  }

  // Step 6: Sort, filter, and limit
  // BM25-matched docs first (by hybrid score), then semantic-only docs (by cosine)
  bm25Matched.sort((a, b) => b.score - a.score);
  bm25Unmatched.sort((a, b) => b.score - a.score);

  // When BM25 found matches, include ALL accessible docs (preserves system/admin docs
  // that should be visible even if they don't match keywords)
  // When BM25 found nothing (pure semantic), require threshold to filter noise
  const MIN_SEMANTIC_THRESHOLD = 0.70;
  const filteredUnmatched = bm25Matched.length > 0
    ? bm25Unmatched  // Include all when BM25 has matches
    : bm25Unmatched.filter(r => r.semanticScore >= MIN_SEMANTIC_THRESHOLD);

  return [...bm25Matched, ...filteredUnmatched].slice(0, limit);
}

// ── BM25-only Fallback Search ──────────────────────────────────────────────────

/**
 * BM25-only search (no embedding API needed).
 * Used as fallback when Gemini embeddings are unavailable.
 */
export function bm25Search(
  query: string,
  documents: RagDocument[],
  bm25Index: BM25Index,
  limit: number = 5,
  categories?: string[],
  userId?: string
): HybridSearchResult[] {
  const allScores = bm25Score(query, bm25Index);

  const results: HybridSearchResult[] = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];

    // Access control
    if (userId) {
      const allowed = doc.metadata.shared ||
        !doc.metadata.author ||
        doc.metadata.author === "admin" ||
        doc.metadata.author === "system" ||
        doc.metadata.author === userId;
      if (!allowed) continue;
    } else {
      const allowed = doc.metadata.shared ||
        !doc.metadata.author ||
        doc.metadata.author === "admin" ||
        doc.metadata.author === "system";
      if (!allowed) continue;
    }

    // Category filter
    if (categories && categories.length > 0) {
      if (!categories.includes(doc.metadata.category)) continue;
    }

    const score = allScores[i];
    results.push({
      doc,
      score,
      semanticScore: 0,
      bm25Score: score,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ── Public getters for status ──────────────────────────────────────────────────

export function getSemanticSearchStatus(): {
  geminiEmbeddings: boolean;
  bm25Ready: boolean;
  cachedDocCount: number;
  cachedQueryCount: number;
} {
  return {
    geminiEmbeddings: geminiEmbedder !== null,
    bm25Ready: embedderInitAttempted,
    cachedDocCount: docEmbeddingStore.size,
    cachedQueryCount: queryEmbeddingCache.size,
  };
}
