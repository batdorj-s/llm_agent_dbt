/**
 * shared.ts — Shared utilities for all route modules.
 */

import { z } from "zod";
import fs from "fs";
import multer from "multer";
import type { Request } from "express";
import type express from "express";
import type { UserRole } from "../multi-agent.js";

// ── Constants ──────────────────────────────────────────────────
export const REQUEST_TIMEOUT_MS = 60_000; // 60 seconds

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
    reqId: req?.reqId || "-",
  };
  if (meta) Object.assign(entry, meta);
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(entry));
}

// ── Auth helpers ──────────────────────────────────────────────

/** Extract userId from request (set by requireAuth middleware) */
export function getUserId(req: express.Request): string {
  const userId = (req as any).userId as string | undefined;
  if (!userId) {
    // Fallback for public routes that bypass requireAuth
    return "user-admin-001";
  }
  return userId;
}

/** Extract role from request (set by requireAuth middleware) */
export function getRole(req: express.Request): UserRole {
  const role = (req as any).role as UserRole | undefined;
  if (!role) {
    return "admin";
  }
  return role;
}

// ── Date filter ───────────────────────────────────────────────

const DateFilterSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD").optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD").optional(),
});

export function extractDateFilter(req: express.Request): { startDate?: string; endDate?: string } {
  const parsed = DateFilterSchema.safeParse({
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  });
  if (!parsed.success) return {};
  return parsed.data;
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

export const MAX_UPLOAD_SIZE_BYTES = parseInt(process.env.MAX_UPLOAD_SIZE_MB || "10", 10) * 1024 * 1024;

export const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: Excel, PDF, DOCX, CSV`));
    }
  },
});
