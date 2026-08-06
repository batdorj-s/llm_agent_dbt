/**
 * admin-analytics.router.ts — Admin Platform Analytics
 *
 * GET /api/admin/analytics → Aggregated usage analytics for the admin
 * dashboard: 14-day SQL time series, top tables, top users, outcome
 * distribution, feedback rating distribution, and duration stats.
 *
 * All routes require auth + admin:system permission.
 */

import { Router } from "express";
import fs from "fs";
import path from "path";
import { getPool } from "../db/pool.js";
import { requirePermission } from "../middleware/rbac.js";
import { log } from "./shared.js";

const router = Router();

const FAILED_QUERIES_PATH = path.resolve(process.cwd(), "data", "failed-queries.json");

function readFailedQueries(): Array<Record<string, unknown>> {
  try {
    const raw = fs.readFileSync(FAILED_QUERIES_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Aggregated analytics across sql_gen_log + feedback */
router.get("/analytics", requirePermission("admin:system"), async (_req, res) => {
  try {
    const pool = getPool();

    // 14-day time series: per-day total / success / failed counts
    const timeSeries = await pool.query(
      `SELECT
         to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE outcome = 'success') AS success,
         COUNT(*) FILTER (WHERE outcome = 'error') AS failed
       FROM sql_gen_log
       WHERE created_at >= NOW() - INTERVAL '14 days'
       GROUP BY day
       ORDER BY day ASC`
    );

    // Top 5 tables by query count
    const topTables = await pool.query(
      `SELECT table_name, COUNT(*) AS queries
       FROM sql_gen_log
       WHERE table_name IS NOT NULL
       GROUP BY table_name
       ORDER BY queries DESC
       LIMIT 5`
    );

    // Top 5 users by query count
    const topUsers = await pool.query(
      `SELECT user_id, COUNT(*) AS queries
       FROM sql_gen_log
       WHERE user_id IS NOT NULL
       GROUP BY user_id
       ORDER BY queries DESC
       LIMIT 5`
    );

    // Outcome distribution + duration stats
    const outcomeStats = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE outcome = 'success') AS success,
         COUNT(*) FILTER (WHERE outcome = 'error') AS failed,
         ROUND(AVG(duration_ms))::int AS avg_duration_ms,
         ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_duration_ms,
         ROUND(AVG(attempts), 1) AS avg_attempts
       FROM sql_gen_log`
    );

    // Feedback rating distribution 1..5 from failed-queries.json
    const feedbackAll = readFailedQueries();
    const ratingBuckets = [1, 2, 3, 4, 5].map((r) => ({
      rating: r,
      count: feedbackAll.filter(
        (f) => Number(f.rating) === r || String(f.rating) === String(r)
      ).length,
    }));

    res.json({
      success: true,
      data: {
        timeSeries: timeSeries.rows,
        topTables: topTables.rows,
        topUsers: topUsers.rows,
        outcome: {
          total: Number(outcomeStats.rows[0]?.total ?? 0),
          success: Number(outcomeStats.rows[0]?.success ?? 0),
          failed: Number(outcomeStats.rows[0]?.failed ?? 0),
          avgDurationMs: Number(outcomeStats.rows[0]?.avg_duration_ms ?? 0),
          p95DurationMs: Number(outcomeStats.rows[0]?.p95_duration_ms ?? 0),
          avgAttempts: Number(outcomeStats.rows[0]?.avg_attempts ?? 0),
        },
        feedbackRatings: ratingBuckets,
      },
    });
  } catch (err) {
    log("error", "Failed to build admin analytics", _req as any, {
      error: (err as Error).message,
    });
    res.status(500).json({ error: "Failed to build admin analytics" });
  }
});

export default router;
