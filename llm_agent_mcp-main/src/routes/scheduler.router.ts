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
import cron from "node-cron";
import { getPool } from "../db/pool.js";
import { requirePermission } from "../middleware/rbac.js";
import { log } from "./shared.js";

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
    const result = await pool.query(
      `SELECT id, name, description, query, format, cron_expression, recipients,
              is_active, last_run_at, next_run_at, created_at
       FROM scheduled_reports
       ORDER BY created_at DESC`
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

router.post("/scheduler/reports", requirePermission("report:read"), async (req, res) => {
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

    const id = `sched_${crypto.randomBytes(8).toString("hex")}`;
    const userId = (req as any).user?.userId || "unknown";
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

router.put("/scheduler/reports/:id", requirePermission("report:read"), async (req, res) => {
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

    const pool = getPool();
    const existing = await pool.query("SELECT id FROM scheduled_reports WHERE id = $1", [req.params.id]);
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
    await pool.query(`UPDATE scheduled_reports SET ${sets.join(", ")} WHERE id = $${idx}`, params);

    res.json({ success: true, message: "Scheduled report updated" });
  } catch (err) {
    log("error", "Failed to update scheduled report", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to update scheduled report" });
  }
});

router.delete("/scheduler/reports/:id", requirePermission("report:read"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query("DELETE FROM scheduled_reports WHERE id = $1 RETURNING id", [req.params.id]);
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

export default router;
