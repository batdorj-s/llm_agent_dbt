import type { Request, Response, NextFunction } from "express";

// ── Standard API Response Envelope ──────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total: number;
    page: number;
    limit: number;
  };
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({ success: true, data } satisfies ApiResponse<T>);
}

export function sendError(res: Response, error: string, statusCode = 500): void {
  res.status(statusCode).json({ success: false, error } satisfies ApiResponse);
}

export function sendPaginated<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number,
): void {
  res.status(200).json({
    success: true,
    data,
    meta: { total, page, limit },
  } satisfies ApiResponse<T[]>);
}

// ── Async Handler Wrapper ───────────────────────────────────
// Eliminates repetitive try/catch in async route handlers
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(fn: AsyncHandler): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ── Global Error Handler Middleware ──────────────────────────
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[API Error]", err.message, err.stack?.split("\n").slice(0, 3).join(" | "));

  if (err.message.includes("not found") || err.message.includes("Not found")) {
    res.status(404).json({ success: false, error: err.message } satisfies ApiResponse);
    return;
  }

  if (err.message.includes("validation") || err.message.includes("invalid")) {
    res.status(400).json({ success: false, error: err.message } satisfies ApiResponse);
    return;
  }

  res.status(500).json({ success: false, error: "Internal server error" } satisfies ApiResponse);
}
