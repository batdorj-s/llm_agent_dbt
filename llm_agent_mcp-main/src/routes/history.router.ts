import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getPool } from "../db/data-lake.js";

const router = Router();

/**
 * GET /api/history — return recent SQL query history
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id ?? null;
    const pool = getPool();
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const result = await pool.query(
      `SELECT id, user_id, request_id, ip_address, query, outcome, attempts, table_name, error, duration_ms, created_at
       FROM sql_gen_log
       WHERE ($1::text IS NULL OR user_id = $1)
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/history/stats — return aggregate query stats
 */
router.get("/stats", requireAuth, async (_req, res) => {
  try {
    const pool = getPool();
    const stats = await pool.query(`
      SELECT
        COUNT(*) AS total_queries,
        COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
        COUNT(*) FILTER (WHERE outcome = 'error') AS error_count,
        ROUND(AVG(duration_ms))::int AS avg_duration_ms,
        COUNT(DISTINCT user_id) AS unique_users,
        COUNT(DISTINCT table_name) AS unique_tables
      FROM sql_gen_log
    `);
    res.json({ success: true, data: stats.rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * DELETE /api/history — clear query history (admin only)
 */
router.delete("/", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!user?.role || user.role !== "admin") {
      res.status(403).json({ success: false, error: "Admin required" });
      return;
    }
    const pool = getPool();
    await pool.query("DELETE FROM sql_gen_log");
    res.json({ success: true, message: "Query history cleared" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
