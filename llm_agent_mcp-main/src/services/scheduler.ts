import cron from "node-cron";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getPool } from "../db/pool.js";
import { getPool as getDataLakePool } from "../db/data-lake.js";

let schedulerTask: ReturnType<typeof cron.schedule> | null = null;

const REPORTS_DIR = path.resolve("generated_reports");

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function getUserIdFromReport(report: any): string {
  return report.created_by || "user-admin-001";
}

function getFormatLabel(format: string): string {
  const map: Record<string, string> = { pdf: "pdf", xlsx: "xlsx", csv: "csv", json: "json" };
  return map[format] || "pdf";
}

async function generateCsv(query: string, pool: any): Promise<{ buffer: Buffer; rowCount: number }> {
  const { rows } = await pool.query(query);
  if (!rows || rows.length === 0) {
    return { buffer: Buffer.from("\uFEFF"), rowCount: 0 };
  }
  const headers = Object.keys(rows[0]);
  const csvRows = [
    headers.join(","),
    ...rows.map((row: any) =>
      headers.map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return "";
        const str = String(val);
        if (str.includes(",") || str.includes("\n") || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(",")
    ),
  ];
  return { buffer: Buffer.from("\uFEFF" + csvRows.join("\n")), rowCount: rows.length };
}

async function generateJson(query: string, pool: any): Promise<{ buffer: Buffer; rowCount: number }> {
  const { rows } = await pool.query(query);
  const json = JSON.stringify({ data: rows, count: rows.length, generatedAt: new Date().toISOString() }, null, 2);
  return { buffer: Buffer.from(json), rowCount: rows.length };
}

async function generatePdf(userId: string): Promise<{ buffer: Buffer; rowCount: number }> {
  const { generateReportPdf } = await import("../agents/reportExport.js");
  const buffer = await generateReportPdf(userId);
  return { buffer, rowCount: 0 };
}

async function generateXlsx(userId: string): Promise<{ buffer: Buffer; rowCount: number }> {
  const { generateReportXlsx } = await import("../agents/reportExport.js");
  const buffer = await generateReportXlsx(userId);
  return { buffer, rowCount: 0 };
}

export function startScheduler(): void {
  if (schedulerTask) return;

  ensureReportsDir();

  schedulerTask = cron.schedule("* * * * *", async () => {
    try {
      const pool = getPool();
      const now = new Date().toISOString();

      const result = await pool.query(
        `SELECT id, name, query, format, cron_expression, recipients, created_by
         FROM scheduled_reports
         WHERE is_active = true AND (next_run_at IS NULL OR next_run_at <= $1)
         ORDER BY next_run_at ASC NULLS FIRST
         LIMIT 10`,
        [now]
      );

      for (const report of result.rows) {
        try {
          const nextRun = computeNextRun(report.cron_expression);
          const format = getFormatLabel(report.format);

          let buffer: Buffer;
          let rowCount = 0;

          switch (format) {
            case "csv": {
              const dataPool = getDataLakePool();
              const r = await generateCsv(report.query, dataPool);
              buffer = r.buffer;
              rowCount = r.rowCount;
              break;
            }
            case "json": {
              const dataPool = getDataLakePool();
              const r = await generateJson(report.query, dataPool);
              buffer = r.buffer;
              rowCount = r.rowCount;
              break;
            }
            case "pdf": {
              const r = await generatePdf(getUserIdFromReport(report));
              buffer = r.buffer;
              rowCount = r.rowCount;
              break;
            }
            case "xlsx": {
              const r = await generateXlsx(getUserIdFromReport(report));
              buffer = r.buffer;
              rowCount = r.rowCount;
              break;
            }
            default: {
              console.warn(`[scheduler] Unknown format "${format}" for report ${report.id}`);
              continue;
            }
          }

          const fileId = crypto.randomBytes(8).toString("hex");
          const ext = format === "xlsx" ? "xlsx" : format;
          const fileName = `${fileId}.${ext}`;
          const filePath = path.join(REPORTS_DIR, fileName);
          fs.writeFileSync(filePath, buffer);

          await pool.query(
            `INSERT INTO generated_reports (id, schedule_id, format, file_path, file_size, row_count, query, generated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [fileId, report.id, format, filePath, buffer.length, rowCount, report.query, report.created_by || "scheduler"]
          );

          await pool.query(
            `UPDATE scheduled_reports
             SET last_run_at = $1, next_run_at = $2
             WHERE id = $3`,
            [now, nextRun?.toISOString() || null, report.id]
          );

          console.log(`[scheduler] Generated ${format} report "${report.name}" (${fileId}) — ${buffer.length} bytes`);

          // Send notifications
          try {
            const { sendNotificationToAllChannels } = await import("./notifications.js");
            const userId = report.created_by || "user-admin-001";
            await sendNotificationToAllChannels(userId, {
              subject: `Report Ready: ${report.name}`,
              body: `Your scheduled report "${report.name}" has been generated.\n\nFormat: ${format.toUpperCase()}\nRows: ${rowCount}\nSize: ${(buffer.length / 1024).toFixed(1)} KB\nGenerated: ${new Date().toISOString()}`,
            });
          } catch (notifErr) {
            console.warn(`[scheduler] Notification failed for report ${report.id}:`, (notifErr as Error).message);
          }
        } catch (err: unknown) {
          console.error(`[scheduler] Failed to generate report ${report.id}:`, (err as Error).message);
        }
      }
    } catch (err: unknown) {
      console.error("[scheduler] Check cycle failed:", (err as Error).message);
    }
  });

  console.log("[scheduler] Started (check interval: every minute, output: " + REPORTS_DIR + ")");
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

export { computeNextRun, generateCsv, generateJson, generatePdf, generateXlsx };
