/**
 * shared.ts — Shared utilities for all route modules.
 */

import fs from "fs";
import multer from "multer";
import type { Request } from "express";

// ── Structured logger ─────────────────────────────────────────

export function log(
  level: "info" | "warn" | "error",
  msg: string,
  req?: Request,
  meta?: Record<string, unknown>
): void {
  const entry: Record<string, unknown> = {
    t:     new Date().toISOString(),
    lvl:   level,
    msg,
    reqId: (req as any)?.reqId || "-",
  };
  if (meta) Object.assign(entry, meta);
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(entry));
}

// ── Multer upload ─────────────────────────────────────────────

const UPLOAD_DIR = "uploads/";
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
]);

export const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: Excel, PDF, DOCX, CSV`));
    }
  },
});
