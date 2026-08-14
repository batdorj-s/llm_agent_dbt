/**
 * audit.ts — Audit logging middleware.
 *
 * Records state-changing requests (POST/PUT/PATCH/DELETE) into the
 * audit_log table. GET requests are intentionally skipped — they are
 * already captured by the request logger.
 *
 * In test mode (NODE_ENV=test) audit writes are skipped so parallel test
 * runs never accumulate persistent rows.
 */

import type { Request, Response, NextFunction } from "express";
import { getPool } from "../db/pool.js";
import { getContext } from "../context.js";

// action mapping — derive a stable action name from the request path
const ACTION_RULES: Array<{ pattern: RegExp; action: string }> = [
  { pattern: /^\/api\/auth\/login/,        action: "auth.login" },
  { pattern: /^\/api\/auth\/register/,     action: "auth.register" },
  { pattern: /^\/api\/chat/,               action: "chat.send" },
  { pattern: /^\/api\/admin\/feedback\/batch/,  action: "feedback.batch" },
  { pattern: /^\/api\/admin\/feedback\/[^/]+\/(approve|reject)$/, action: "feedback.decision" },
  { pattern: /^\/api\/admin\/feedback/,    action: "feedback.update" },
  { pattern: /^\/api\/feedback/,           action: "feedback.submit" },
  { pattern: /^\/api\/admin\/users/,       action: "admin.users" },
  { pattern: /^\/api\/admin\/documents/,   action: "admin.documents" },
  { pattern: /^\/api\/admin\/api-keys/,    action: "admin.api-keys" },
  { pattern: /^\/api\/admin\/upload/,      action: "file.upload" },
  { pattern: /^\/api\/admin/,              action: "admin.action" },
  { pattern: /^\/api\/sharing/,            action: "sharing" },
  { pattern: /^\/api\/teams/,              action: "teams" },
  { pattern: /^\/api\/scheduler/,          action: "scheduler" },
  { pattern: /^\/api\/conversations\/[^/]+\/delete/, action: "conversation.delete" },
  { pattern: /^\/api\/conversations/,      action: "conversation" },
  { pattern: /^\/api\/whatif/,             action: "whatif" },
  { pattern: /^\/api\/kpi\/anomalies/,     action: "kpi.anomaly" },
  { pattern: /^\/api\/data-quality/,       action: "data-quality" },
  { pattern: /^\/api\/history/,            action: "history" },
  { pattern: /^\/api\/finance-mapper/,     action: "finance-mapper" },
  { pattern: /^\/api\/export/,             action: "export" },
  { pattern: /^\/api\/alerts/,             action: "alerts" },
];

export function deriveAction(method?: string, path?: string): string {
  const normalized = (path ?? "").split("?")[0] || path || "/";
  for (const rule of ACTION_RULES) {
    if (rule.pattern.test(normalized)) return rule.action;
  }
  return `${(method ?? "POST").toLowerCase()}.generic`;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Fire-and-forget audit write — never blocks or throws on the request path. */
export async function writeAuditLog(entry: {
  action: string;
  method: string;
  path: string;
  status: number;
  userId?: string | null;
  ip?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  try {
    await getPool().query(
      `INSERT INTO audit_log (user_id, action, method, path, status, ip, request_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.userId ?? null,
        entry.action,
        entry.method,
        entry.path,
        entry.status,
        entry.ip ?? null,
        entry.requestId ?? null,
        JSON.stringify(entry.details ?? {}),
      ]
    );
  } catch (err) {
    console.warn("[Audit] failed to write audit log:", err instanceof Error ? err.message : String(err));
  }
}

/** Express middleware that records the outcome of write requests after they finish. */
export function auditWrites(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === "test" || !WRITE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.path.startsWith("/health") || req.path.startsWith("/status")) {
    next();
    return;
  }

  const user = (req as any).user as { userId?: string } | undefined;
  const ctx = getContext();
  const ip = ctx?.ipAddress ?? req.ip;
  const requestId = ctx?.requestId ?? req.reqId;
  const originalUrl = req.originalUrl;
  const method = req.method;

  res.on("finish", () => {
    void writeAuditLog({
      action: deriveAction(method, originalUrl),
      method,
      path: originalUrl,
      status: res.statusCode,
      userId: user?.userId ?? ctx?.userId,
      ip,
      requestId,
    });
  });

  next();
}