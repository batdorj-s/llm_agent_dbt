/**
 * admin-summary.router.ts — Admin Observability Summary
 *
 * GET /api/admin/summary → Counts + recent activity across the platform:
 *   users, api_keys, uploaded_files, rag_documents, sql_gen_log,
 *   feedback (pending/approved), scheduled_reports, generated_reports
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

/** Aggregate platform summary */
router.get("/summary", requirePermission("admin:system"), async (_req, res) => {
  try {
    const pool = getPool();

    const [users, apiKeys, files, docs, sqlLog, sched, reports, quality] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS count FROM users`),
      pool.query(`SELECT COUNT(*) AS count FROM api_keys`),
      pool.query(`SELECT COUNT(*) AS count FROM uploaded_files`),
      pool.query(`SELECT COUNT(*) AS count FROM rag_documents`),
      pool.query(`SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE outcome = 'success') AS succeeded,
                    COUNT(*) FILTER (WHERE outcome = 'error') AS failed,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h
                  FROM sql_gen_log`),
      pool.query(`SELECT COUNT(*) AS count FROM scheduled_reports WHERE is_active = true`),
      pool.query(`SELECT COUNT(*) AS count FROM generated_reports`),
      pool.query(`SELECT COUNT(*) AS count FROM data_quality_tests`),
    ]);

    const feedbackAll = readFailedQueries();
    const feedbackPending = feedbackAll.filter((f) => f.status === "pending").length;
    const feedbackApproved = feedbackAll.filter((f) => f.status === "approved").length;

    const recentLogs = await pool.query(
      `SELECT id, user_id, query, outcome, attempts, table_name, error, duration_ms, created_at
       FROM sql_gen_log
       ORDER BY created_at DESC
       LIMIT 20`
    );

    const recentFeedback = feedbackAll
      .filter((f) => f.status === "pending")
      .slice(0, 10)
      .map((f) => ({
        id: f.id,
        message: f.message,
        rating: f.rating,
        createdAt: f.createdAt,
      }));

    res.json({
      success: true,
      data: {
        counts: {
          users: Number(users.rows[0]?.count ?? 0),
          apiKeys: Number(apiKeys.rows[0]?.count ?? 0),
          uploadedFiles: Number(files.rows[0]?.count ?? 0),
          ragDocuments: Number(docs.rows[0]?.count ?? 0),
          sqlLogs: Number(sqlLog.rows[0]?.total ?? 0),
          sqlSucceeded: Number(sqlLog.rows[0]?.succeeded ?? 0),
          sqlFailed: Number(sqlLog.rows[0]?.failed ?? 0),
          sqlLast24h: Number(sqlLog.rows[0]?.last_24h ?? 0),
          activeSchedules: Number(sched.rows[0]?.count ?? 0),
          generatedReports: Number(reports.rows[0]?.count ?? 0),
          qualityTests: Number(quality.rows[0]?.count ?? 0),
          feedbackPending,
          feedbackApproved,
        },
        recentSqlLogs: recentLogs.rows,
        recentFeedback,
      },
    });
  } catch (err) {
    log("error", "Failed to build admin summary", _req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to build admin summary" });
  }
});

export default router;