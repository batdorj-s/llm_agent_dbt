/**
 * scheduler.router.ts — Scheduled Reports API
 *
 * GET    /api/scheduler/reports        → List all scheduled reports
 * POST   /api/scheduler/reports        → Create a new scheduled report
 * PUT    /api/scheduler/reports/:id    → Update a scheduled report
 * DELETE /api/scheduler/reports/:id    → Delete a scheduled report
 */

import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import cron from "node-cron";
import { getPool } from "../db/pool.js";
import { assertSelectOnly } from "../db/sql-utils.js";
import { requirePermission } from "../middleware/rbac.js";
import { log, getUserId, getRole } from "./shared.js";

const router = Router();

const VALID_FORMATS = ["pdf", "xlsx", "csv", "json"];

function validateCron(expr: string): string | null {
  if (cron.validate(expr)) return null;
  return `Invalid cron expression: "${expr}". Use standard 5-field format (e.g., "0 8 * * 1" for every Monday 8am).`;
}

function parseCronComponents(expr: string): Record<string, string> {
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return { raw: expr };
  const labels = ["minute", "hour", "dayOfMonth", "month", "dayOfWeek"];
  const result: Record<string, string> = { raw: expr };
  parts.forEach((p, i) => { result[labels[i]] = p; });
  return result;
}

function computeNextRun(expr: string): string | null {
  if (!cron.validate(expr)) return null;
  const task = cron.schedule(expr, () => {}) as any;
  const next = task.nextDate ? task.nextDate() : null;
  if (task.stop) task.stop();
  if (task.destroy) task.destroy();
  return next ? (typeof next.toISOString === "function" ? next.toISOString() : String(next)) : null;
}

router.get("/scheduler/reports", requirePermission("report:read"), async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = getRole(req) === "admin";
    const userId = getUserId(req);
    const result = await pool.query(
      `SELECT id, name, description, query, format, cron_expression, recipients,
              is_active, last_run_at, next_run_at, created_at
       FROM scheduled_reports
       ${isAdmin ? "" : "WHERE created_by = $1"}
       ORDER BY created_at DESC`,
      isAdmin ? [] : [userId]
    );
    res.json({
      success: true,
      data: result.rows.map((r: any) => ({
        ...r,
        cronComponents: parseCronComponents(r.cron_expression),
      })),
    });
  } catch (err) {
    log("error", "Failed to list scheduled reports", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to list scheduled reports" });
  }
});

router.post("/scheduler/reports", requirePermission("report:write"), async (req, res) => {
  try {
    const { name, description, query, format, cron_expression, recipients } = req.body;

    if (!name || !query || !cron_expression) {
      res.status(400).json({ error: "name, query, and cron_expression are required" });
      return;
    }

    const cronError = validateCron(cron_expression);
    if (cronError) {
      res.status(400).json({ error: cronError });
      return;
    }

    if (format && !VALID_FORMATS.includes(format)) {
      res.status(400).json({ error: `Invalid format. Valid: ${VALID_FORMATS.join(", ")}` });
      return;
    }

    try {
      assertSelectOnly(query);
    } catch (err) {
      res.status(400).json({ error: `Invalid query: ${(err as Error).message}` });
      return;
    }

    const id = `sched_${crypto.randomBytes(8).toString("hex")}`;
    const userId = getUserId(req);
    const pool = getPool();
    const nextRunAt = computeNextRun(cron_expression);

    await pool.query(
      `INSERT INTO scheduled_reports (id, name, description, query, format, cron_expression, recipients, created_by, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, name, description || "", query, format || "pdf", cron_expression, recipients || [], userId, nextRunAt]
    );

    log("info", `Scheduled report created: ${id}`, req as any, { name, cron: cron_expression });

    res.status(201).json({ success: true, data: { id, name, nextRunAt } });
  } catch (err) {
    log("error", "Failed to create scheduled report", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to create scheduled report" });
  }
});

router.put("/scheduler/reports/:id", requirePermission("report:write"), async (req, res) => {
  try {
    const { name, description, query, format, cron_expression, recipients, is_active } = req.body;

    if (cron_expression) {
      const cronError = validateCron(cron_expression);
      if (cronError) {
        res.status(400).json({ error: cronError });
        return;
      }
    }

    if (format && !VALID_FORMATS.includes(format)) {
      res.status(400).json({ error: `Invalid format. Valid: ${VALID_FORMATS.join(", ")}` });
      return;
    }

    if (query !== undefined) {
      try {
        assertSelectOnly(query);
      } catch (err) {
        res.status(400).json({ error: `Invalid query: ${(err as Error).message}` });
        return;
      }
    }

    const pool = getPool();
    const isAdmin = getRole(req) === "admin";
    const userId = getUserId(req);
    const existing = await pool.query(
      `SELECT id FROM scheduled_reports WHERE id = $1 ${isAdmin ? "" : "AND created_by = $2"}`,
      isAdmin ? [req.params.id] : [req.params.id, userId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Scheduled report not found" });
      return;
    }

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx++}`); params.push(name); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); params.push(description); }
    if (query !== undefined) { sets.push(`query = $${idx++}`); params.push(query); }
    if (format !== undefined) { sets.push(`format = $${idx++}`); params.push(format); }
    if (recipients !== undefined) { sets.push(`recipients = $${idx++}`); params.push(recipients); }
    if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(is_active); }
    if (cron_expression !== undefined) {
      sets.push(`cron_expression = $${idx++}`);
      params.push(cron_expression);
      const nextRun = computeNextRun(cron_expression);
      sets.push(`next_run_at = $${idx++}`);
      params.push(nextRun);
    }

    if (sets.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    params.push(req.params.id);
    await pool.query(
      `UPDATE scheduled_reports SET ${sets.join(", ")} WHERE id = $${idx} ${isAdmin ? "" : "AND created_by = $" + (idx + 1)}`,
      isAdmin ? params : [...params, userId]
    );

    res.json({ success: true, message: "Scheduled report updated" });
  } catch (err) {
    log("error", "Failed to update scheduled report", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to update scheduled report" });
  }
});

router.delete("/scheduler/reports/:id", requirePermission("report:write"), async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = getRole(req) === "admin";
    const userId = getUserId(req);
    const result = await pool.query(
      `DELETE FROM scheduled_reports WHERE id = $1 ${isAdmin ? "" : "AND created_by = $2"} RETURNING id`,
      isAdmin ? [req.params.id] : [req.params.id, userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Scheduled report not found" });
      return;
    }
    log("info", `Scheduled report deleted: ${req.params.id}`, req as any, {});
    res.json({ success: true, message: "Scheduled report deleted" });
  } catch (err) {
    log("error", "Failed to delete scheduled report", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to delete scheduled report" });
  }
});

// ── Report Download ────────────────────────────────────────

router.get("/scheduler/reports/:id/download", requirePermission("report:read"), async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = getRole(req) === "admin";
    const userId = getUserId(req);
    const result = await pool.query(
      `SELECT gr.id, gr.schedule_id, gr.format, gr.file_path, gr.file_size, gr.row_count, gr.generated_at
       FROM generated_reports gr
       LEFT JOIN scheduled_reports sr ON sr.id = gr.schedule_id
       WHERE gr.id = $1 ${isAdmin ? "" : "AND sr.created_by = $2"}`,
      isAdmin ? [req.params.id] : [req.params.id, userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Generated report not found" });
      return;
    }
    const report = result.rows[0];

    if (!fs.existsSync(report.file_path)) {
      res.status(404).json({ error: "Report file not found on disk" });
      return;
    }

    const contentTypeMap: Record<string, string> = {
      pdf: "application/pdf",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      csv: "text/csv",
      json: "application/json",
    };
    const contentType = contentTypeMap[report.format] || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="report-${report.id}.${report.format}"`);
    res.setHeader("Content-Length", String(report.file_size));

    const fileStream = fs.createReadStream(report.file_path);
    fileStream.pipe(res);
  } catch (err) {
    log("error", "Failed to download report", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to download report" });
  }
});

// ── Generated Reports List ────────────────────────────────

router.get("/scheduler/reports/generated", requirePermission("report:read"), async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = getRole(req) === "admin";
    const userId = getUserId(req);
    const result = await pool.query(
      `SELECT gr.id, gr.schedule_id, sr.name AS report_name, gr.format, gr.file_size, gr.row_count, gr.generated_at
       FROM generated_reports gr
       LEFT JOIN scheduled_reports sr ON sr.id = gr.schedule_id
       ${isAdmin ? "" : "WHERE sr.created_by = $1"}
       ORDER BY gr.generated_at DESC
       LIMIT 100`,
      isAdmin ? [] : [userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    log("error", "Failed to list generated reports", req as any, { error: (err as Error).message });
    res.status(500).json({ success: false, error: "Failed to list generated reports" });
  }
});

export default router;
