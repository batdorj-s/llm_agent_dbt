/**
 * rag.ts — Barrel re-export for backward compatibility.
 *
 * All functionality has been split into focused modules:
 *   chroma-client.ts   — ChromaDB connection and collection singleton
 *   knowledge-base.ts  — Document types, loading, chunking, embedding readiness, setup
 *   hybrid-search.ts   — Hybrid search (ChromaDB + BM25 + recency), self-query, document ops
 *
 * This file re-exports everything so existing `from "../rag.js"` imports keep working.
 */

export { getChromaCollection } from "./rag/chroma-client.js";
export {
  type RagDocument,
  mockDocuments,
  getKnowledgeDocuments,
  setKnowledgeDocuments,
  getBm25Index,
  ROLE_CATEGORY_MAP,
  loadKnowledgeBase,
  setupKnowledgeBase,
  waitForEmbeddings,
  estimateTokens,
  chunkText,
} from "./rag/knowledge-base.js";
export {
  type SelfQueryFilter,
  clearRagResultCache,
  clearQueryExpansionCache,
  expandQuery,
  generateHypotheticalDocument,
  searchKnowledgeBase,
  searchKnowledgeBaseWithFilter,
  formatRagDocuments,
  selfQueryTransform,
  removeDocumentsByPrefix,
  addDocumentToCatalog,
  getPassportByTableName,
  parsePassportQuestions,
} from "./rag/hybrid-search.js";
