/**
 * audit.router.ts — Read-only access to the audit_log table.
 * All writes happen automatically via the auditWrites middleware.
 */

import { Router } from "express";
import { getPool } from "../db/pool.js";
import { requireAuth } from "../auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { log } from "./shared.js";

const router = Router();

interface AuditQuery {
  limit: number;
  offset: number;
  search: string;
}

function parseAuditQuery(query: Record<string, unknown>): AuditQuery {
  const rawLimit = Number(query.limit);
  const rawOffset = Number(query.offset);
  return {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50,
    offset: Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0,
    search: typeof query.search === "string" ? query.search.trim() : "",
  };
}

router.get("/audit", requireAuth, requirePermission("admin:system"), async (req, res) => {
  const { limit, offset, search } = parseAuditQuery(req.query);

  try {
    const pool = getPool();

    let where = "";
    const params: unknown[] = [];
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE action ILIKE $1 OR path ILIKE $1 OR user_id ILIKE $1`;
    }
    params.push(limit, offset);

    const [rowsResult, totalResult] = await Promise.all([
      pool.query(
        `SELECT id, user_id, action, method, path, status, ip, request_id, details, created_at
         FROM audit_log
         ${where}
         ORDER BY created_at DESC
         LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`,
        params
      ),
      pool.query(`SELECT COUNT(*) AS count FROM audit_log ${where}`, search ? [params[0]] : []),
    ]);

    res.json({
      success: true,
      data: rowsResult.rows,
      meta: { total: Number(totalResult.rows[0]?.count ?? 0), limit, offset },
    });
  } catch (err) {
    log("error", "Failed to fetch audit log", req, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

router.get("/audit/actions", requireAuth, requirePermission("admin:system"), async (_req, res) => {
  try {
    const result = await getPool().query(
      `SELECT action, COUNT(*) AS count
       FROM audit_log
       GROUP BY action
       ORDER BY count DESC
       LIMIT 30`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;