/**
 * admin-documents.router.ts — Knowledge Base / RAG Document Management
 *
 * GET    /api/admin/documents          → List RAG documents (search / category / department filter)
 * GET    /api/admin/documents/categories → Distinct categories + departments for filters
 * DELETE /api/admin/documents/:id      → Delete a document chunk (+ children via parent_doc_id)
 *
 * All routes require auth + admin:upload permission.
 */

import { Router } from "express";
import { getPool } from "../db/pool.js";
import { requirePermission } from "../middleware/rbac.js";
import { log } from "./shared.js";

const router = Router();

/** List RAG documents with search / category / department filtering */
router.get("/documents", requirePermission("admin:upload"), async (req, res) => {
  try {
    const { search, category, department, limit } = req.query;
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (search && typeof search === "string") {
      clauses.push(`(text ILIKE $${params.length + 1} OR id ILIKE $${params.length + 1} OR source_name ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }
    if (category && typeof category === "string") {
      clauses.push(`category = $${params.length + 1}`);
      params.push(category);
    }
    if (department && typeof department === "string") {
      clauses.push(`department = $${params.length + 1}`);
      params.push(department);
    }

    const max = Math.min(Math.max(parseInt(String(limit || "100"), 10) || 100, 1), 500);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const result = await getPool().query(
      `SELECT id, category, department, author, source_name, parent_doc_id, chunk_index,
              shared, keywords, uploaded_at,
              length(text) AS text_length,
              left(text, 200) AS text_preview
       FROM rag_documents
       ${where}
       ORDER BY uploaded_at DESC
       LIMIT $${params.length + 1}`,
      [...params, max]
    );

    const total = await getPool().query(
      `SELECT COUNT(*) AS count FROM rag_documents ${where}`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      meta: { total: Number(total.rows[0]?.count ?? 0), limit: max },
    });
  } catch (err) {
    log("error", "Failed to list RAG documents", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to list RAG documents" });
  }
});

/** Distinct categories + departments for filter dropdowns */
router.get("/documents/categories", requirePermission("admin:upload"), async (req, res) => {
  try {
    const [cats, depts] = await Promise.all([
      getPool().query(`SELECT DISTINCT category FROM rag_documents ORDER BY category`),
      getPool().query(`SELECT DISTINCT department FROM rag_documents WHERE department IS NOT NULL ORDER BY department`),
    ]);
    res.json({
      success: true,
      data: {
        categories: cats.rows.map((r: any) => r.category),
        departments: depts.rows.map((r: any) => r.department),
      },
    });
  } catch (err) {
    log("error", "Failed to load document categories", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to load document categories" });
  }
});

/** Delete a document chunk and its children */
router.delete("/documents/:id", requirePermission("admin:upload"), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await getPool().query(
      `DELETE FROM rag_documents
       WHERE id = $1 OR parent_doc_id = $1
       RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    log("info", `Deleted RAG document: ${id}`, req as any, { chunks: result.rows.length });
    res.json({ success: true, message: "Document deleted", deleted: result.rows.length });
  } catch (err) {
    log("error", "Failed to delete document", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to delete document" });
  }
});

export default router;