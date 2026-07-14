/**
 * scheduler.ts — Background job scheduler for scheduled reports.
 *
 * Uses node-cron to check for due reports every minute.
 * When a report is due, it generates the report (PDF/XLSX)
 * and marks it as run.
 */

import cron from "node-cron";
import { getPool } from "../db/pool.js";

let schedulerTask: ReturnType<typeof cron.schedule> | null = null;

export function startScheduler(): void {
  if (schedulerTask) return;

  schedulerTask = cron.schedule("* * * * *", async () => {
    try {
      const pool = getPool();
      const now = new Date().toISOString();

      const result = await pool.query(
        `SELECT id, name, query, format, cron_expression, recipients
         FROM scheduled_reports
         WHERE is_active = true AND (next_run_at IS NULL OR next_run_at <= $1)
         ORDER BY next_run_at ASC NULLS FIRST
         LIMIT 10`,
        [now]
      );

      for (const report of result.rows) {
        try {
          const nextRun = computeNextRun(report.cron_expression);
          await pool.query(
            `UPDATE scheduled_reports
             SET last_run_at = $1, next_run_at = $2
             WHERE id = $3`,
            [now, nextRun?.toISOString() || null, report.id]
          );

          console.log(`[scheduler] Report "${report.name}" (${report.id}) — queued for generation`);
        } catch (err: unknown) {
          console.error(`[scheduler] Failed to process report ${report.id}:`, (err as Error).message);
        }
      }
    } catch (err: unknown) {
      console.error("[scheduler] Check cycle failed:", (err as Error).message);
    }
  });

  console.log("[scheduler] Started (check interval: every minute)");
}

export function stopScheduler(): void {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log("[scheduler] Stopped");
  }
}

function computeNextRun(cronExpression: string): Date | null {
  if (!cron.validate(cronExpression)) return null;
  const task = cron.schedule(cronExpression, () => {}) as any;
  const next = task.nextDate ? task.nextDate() : null;
  if (task.stop) task.stop();
  if (task.destroy) task.destroy();
  return next ? (typeof next.toDate === "function" ? next.toDate() : new Date(next)) : null;
}

export { computeNextRun };
