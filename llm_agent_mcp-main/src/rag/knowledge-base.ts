/**
 * knowledge-base.ts — Document types, loading, chunking, embedding readiness, and setup.
 */

import fs from "fs";
import { readFile, access } from "fs/promises";
import path from "path";
import yaml from "yaml";
import { syncDbtModelsToRag, syncDbtTestResultsToRag, syncDbtMetricsToRag } from "../dbt-sync.js";
import {
  buildBM25Index,
  embedDocuments,
  type BM25Index,
} from "./semantic-search.js";
import { getChromaCollection } from "./chroma-client.js";
import { saveRagDocuments, loadRagDocuments } from "./doc-persistence.js";

// ── Types ─────────────────────────────────────────────────────

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

// ── Global state ──────────────────────────────────────────────

let _knowledgeDocuments: RagDocument[] = [];
let _bm25Index: BM25Index | null = null;

/** Read-only view of the knowledge documents array. */
export function getKnowledgeDocuments(): RagDocument[] { return _knowledgeDocuments; }

/** Replace the entire knowledge documents array (for filtering/removal). */
export function setKnowledgeDocuments(docs: RagDocument[]): void { _knowledgeDocuments = docs; }

/** Push new documents onto the knowledge base. */
export function addKnowledgeDocuments(docs: RagDocument[]): void { _knowledgeDocuments.push(...docs); }

export const mockDocuments = _knowledgeDocuments;

/** Read-only view of the current BM25 index. */
export function getBm25Index(): BM25Index | null { return _bm25Index; }

/** Replace the BM25 index (must be called from the defining module). */
export function setBm25Index(idx: BM25Index | null): void { _bm25Index = idx; }

const KNOWLEDGE_BASE_PATH = path.join(process.cwd(), "docs", "knowledge-base.yaml");

export const ROLE_CATEGORY_MAP: Record<string, string[]> = {
  FinanceAgent: ["finance", "business_policy"],
  TechAgent: ["technical", "data_catalog"],
  DataScientistAgent: ["technical", "data_catalog", "previous_analysis"],
};

// ── Embedding readiness gate ──────────────────────────────────

let embeddingReadyResolve: (() => void) | null = null;
let _embeddingReadyReject: ((err: Error) => void) | null = null;
const embeddingReadyPromise = new Promise<void>((resolve, reject) => {
  embeddingReadyResolve = resolve;
  _embeddingReadyReject = reject;
});
let embeddingReady = false;

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

// ── Token estimation & chunking ───────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkText(
  text: string,
  chunkSize: number = 512,
  overlap: number = 64
): string[] {
  const estimatedTokens = estimateTokens(text);
  if (estimatedTokens <= chunkSize) return [text];

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
      const overlapChars = overlap * 4;
      current = current.length > overlapChars
        ? current.slice(-overlapChars) + "\n\n" + para
        : para;
    } else {
      if (paraTokens > chunkSize) {
        if (current.trim()) chunks.push(current.trim());
        const sentences = para.split(/(?<=[.?!…])\s+/);
        current = "";
        for (const sentence of sentences) {
          const sentenceTokens = estimateTokens(sentence);
          if (sentenceTokens > chunkSize) {
            if (current.trim()) chunks.push(current.trim());
            const clauses = sentence.split(/[,;:]\s*/);
            current = "";
            for (const clause of clauses) {
              const _clauseTokens = estimateTokens(clause);
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

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ── YAML loaders ──────────────────────────────────────────────

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

// ── Knowledge base setup ──────────────────────────────────────

export async function setupKnowledgeBase(): Promise<boolean> {
  const yamlDocs = loadKnowledgeBase();
  _knowledgeDocuments.push(...yamlDocs);

  const financeDocs = ingestFinanceGlossary();
  let financeAdded = 0;
  for (const doc of financeDocs) {
    if (!_knowledgeDocuments.some(d => d.id === doc.id)) {
      _knowledgeDocuments.push(doc);
      financeAdded++;
    }
  }
  if (financeAdded > 0) {
    console.log(`[RAG] Loaded ${financeAdded} finance glossary terms`);
  }

  const dbtDocs = syncDbtModelsToRag();
  _knowledgeDocuments.push(...dbtDocs);

  const dbtTestDocs = syncDbtTestResultsToRag();
  _knowledgeDocuments.push(...dbtTestDocs);

  const dbtMetricDocs = syncDbtMetricsToRag();
  _knowledgeDocuments.push(...dbtMetricDocs);

  // Load approved feedback
  try {
    const failedQueriesPath = path.join(process.cwd(), "logs", "failed_queries.json");
    await access(failedQueriesPath).catch(() => { throw new Error("File not found"); });
    const rawData = await readFile(failedQueriesPath, "utf8");
    const data = JSON.parse(rawData);
    for (const entry of data) {
      if (entry.status === "approved" && entry.response) {
        const ragText = `Failed Query: User asked "${entry.message}". The system responded with: "${entry.response}". This response was rated as incorrect.`;
        if (!_knowledgeDocuments.some(d => d.id === entry.id)) {
          _knowledgeDocuments.push({
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

  // Load user-uploaded documents from PostgreSQL (survive restarts)
  try {
    const persistedDocs = await loadRagDocuments();
    const existingIds = new Set(_knowledgeDocuments.map(d => d.id));
    let loaded = 0;
    for (const doc of persistedDocs) {
      if (!existingIds.has(doc.id)) {
        _knowledgeDocuments.push(doc);
        existingIds.add(doc.id);
        loaded++;
      }
    }
    if (loaded > 0) {
      console.log(`[RAG] Loaded ${loaded} persisted documents from database`);
    }
  } catch (err) {
    console.warn("[RAG] Failed to load persisted documents:", (err as Error).message);
  }

  // Persist all documents to database
  try {
    await saveRagDocuments(_knowledgeDocuments);
    console.log(`[RAG] Persisted ${_knowledgeDocuments.length} documents to database`);
  } catch (err) {
    console.warn("[RAG] Failed to persist documents to database:", (err as Error).message);
  }

  // ChromaDB
  const col = await getChromaCollection();
  if (col) {
    console.log("Setting up ChromaDB Vector DB...");
    const existing = await col.count();
    if (existing === 0) {
      await col.add({
        ids: _knowledgeDocuments.map(d => d.id),
        documents: _knowledgeDocuments.map(d => d.text),
        metadatas: _knowledgeDocuments.map(d => ({ ...d.metadata, category: d.metadata.category })),
      });
      console.log(`[VectorDB] ChromaDB setup complete. Added ${_knowledgeDocuments.length} documents.`);
    } else {
      console.log(`[VectorDB] ChromaDB already contains ${existing} documents.`);
    }
  } else {
    console.log(`[VectorDB] In-Memory DB ready. ${_knowledgeDocuments.length} documents loaded.`);
  }

  // Build BM25 index
  if (_knowledgeDocuments.length > 0) {
    _bm25Index = buildBM25Index(_knowledgeDocuments);
    console.log(`[SemanticSearch] BM25 index built: ${_bm25Index.docCount} documents, avg length ${Math.round(_bm25Index.avgDocLength)} tokens`);
  }

  // Embed documents
  try {
    await embedDocuments(_knowledgeDocuments);
    embeddingReady = true;
    embeddingReadyResolve?.();
    console.log("[SemanticSearch] Document embeddings ready — semantic search available");
  } catch (err) {
    console.warn("[SemanticSearch] Document embedding failed (search will use BM25 only):", (err as Error).message);
    embeddingReady = true;
    embeddingReadyResolve?.();
  }

  return true;
}
