/**
 * doc-persistence.ts — Persist RAG documents to PostgreSQL so user-uploaded documents
 * survive server restarts (in-memory _knowledgeDocuments are lost otherwise).
 */

import { getPool, isPgAvailable } from "../db/pool.js";
import type { RagDocument } from "./knowledge-base.js";

export async function saveRagDocuments(docs: RagDocument[]): Promise<void> {
  if (!isPgAvailable() || docs.length === 0) return;
  const pool = getPool();
  const BATCH_SIZE = 100;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];
    for (let j = 0; j < batch.length; j++) {
      const doc = batch[j];
      const base = j * 11;
      placeholders.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`);
      values.push(
        doc.id, doc.text, doc.metadata.category, doc.metadata.department,
        doc.metadata.author || null, doc.metadata.created_at || null,
        doc.metadata.source_name || null, doc.metadata.parent_doc_id || null,
        doc.metadata.chunk_index ?? null, doc.metadata.shared ?? true,
        doc.keywords,
      );
    }
    await pool.query(
      `INSERT INTO rag_documents (id, text, category, department, author, created_at, source_name, parent_doc_id, chunk_index, shared, keywords)
       VALUES ${placeholders.join(",")}
       ON CONFLICT (id) DO UPDATE SET
         text = EXCLUDED.text,
         category = EXCLUDED.category,
         department = EXCLUDED.department,
         author = EXCLUDED.author,
         created_at = EXCLUDED.created_at,
         source_name = EXCLUDED.source_name,
         parent_doc_id = EXCLUDED.parent_doc_id,
         chunk_index = EXCLUDED.chunk_index,
         shared = EXCLUDED.shared,
         keywords = EXCLUDED.keywords`,
      values
    );
  }
}

export async function loadRagDocuments(): Promise<RagDocument[]> {
  if (!isPgAvailable()) return [];
  const pool = getPool();
  const result = await pool.query("SELECT * FROM rag_documents ORDER BY uploaded_at LIMIT 5000");
  return result.rows.map(row => ({
    id: row.id,
    text: row.text,
    metadata: {
      category: row.category,
      department: row.department || "general",
      author: row.author || undefined,
      created_at: row.created_at || undefined,
      source_name: row.source_name || undefined,
      parent_doc_id: row.parent_doc_id || undefined,
      chunk_index: row.chunk_index ?? undefined,
      shared: row.shared ?? true,
    },
    keywords: row.keywords || [],
  }));
}

export async function deleteRagDocumentsByPrefix(idPrefix: string): Promise<number> {
  if (!isPgAvailable()) return 0;
  const pool = getPool();
  const result = await pool.query("DELETE FROM rag_documents WHERE id LIKE $1", [`${idPrefix}%`]);
  return result.rowCount ?? 0;
}
