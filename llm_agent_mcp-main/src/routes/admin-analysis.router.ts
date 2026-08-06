/**
 * admin-analysis.router.ts — Admin SQL Analysis Tool
 *
 * GET  /api/admin/analysis/tables → List shared data-lake tables (for picker)
 * POST /api/admin/analysis/sql    → Execute a read-only SELECT query
 *
 * Security: executeSql() enforces SELECT-only + read-only transaction
 * (assertSelectOnly + SERIALIZABLE READ ONLY) and a max-rows limit.
 * All routes require auth + admin:system permission.
 */

import { Router } from "express";
import { getPool } from "../db/pool.js";
import { executeSql } from "../db/sql-utils.js";
import { requirePermission } from "../middleware/rbac.js";
import { log } from "./shared.js";

const router = Router();

const MAX_QUERY_LENGTH = 10_000;

/** List shared data-lake tables with column names for the query builder */
router.get("/analysis/tables", requirePermission("admin:system"), async (_req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT table_name, columns_info, description, created_at
       FROM data_lake_catalog
       WHERE visibility = 'shared'
       ORDER BY created_at DESC
       LIMIT 200`
    );

    const tables = result.rows.map((row: any) => {
      let columns: string[] = [];
      try {
        const parsed = JSON.parse(row.columns_info ?? "[]");
        columns = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        columns = [];
      }
      return {
        table_name: row.table_name,
        columns,
        description: row.description,
        created_at: row.created_at,
      };
    });

    res.json({ success: true, data: tables, meta: { total: tables.length } });
  } catch (err) {
    log("error", "Failed to list analysis tables", _req as any, {
      error: (err as Error).message,
    });
    res.status(500).json({ error: "Failed to list analysis tables" });
  }
});

/** Execute a read-only SELECT query against the data lake */
router.post("/analysis/sql", requirePermission("admin:system"), async (req, res) => {
  const { query } = (req.body ?? {}) as { query?: unknown };
  const userId = (req as any).user?.userId ?? (req as any).user?.id ?? "admin";

  if (typeof query !== "string" || query.trim().length === 0) {
    res.status(400).json({ error: "Query required" });
    return;
  }
  if (query.length > MAX_QUERY_LENGTH) {
    res.status(400).json({ error: `Query too long (max ${MAX_QUERY_LENGTH} chars)` });
    return;
  }

  const startedAt = Date.now();
  try {
    const rows = await executeSql(query.trim(), true, userId);
    res.json({
      success: true,
      data: {
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        rows,
        rowCount: rows.length,
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("warn", "Admin analysis SQL rejected", req as any, { error: msg });
    res.status(400).json({ error: msg.replace(/^SQL Execution Error:\s*/, "") });
  }
});

export default router;
