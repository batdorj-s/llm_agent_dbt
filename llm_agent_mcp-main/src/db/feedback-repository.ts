/**
 * feedback-repository.ts — PostgreSQL-backed feedback storage.
 *
 * Replaces the legacy file-based storage (data/failed-queries.json).
 * All consumers (feedback.router, admin.router, admin-summary.router)
 * import from here — never touch the pool directly.
 */

import { getPool } from "./pool.js";

export interface FeedbackRecord {
  id: string;
  userId: string | null;
  message: string;
  response: string;
  rating: "positive" | "negative";
  status: "pending" | "approved" | "rejected";
  threadId: string | null;
  timestamp: string;
}

const VALID_STATUS = new Set(["pending", "approved", "rejected"]);
const VALID_RATING = new Set(["positive", "negative"]);

function mapRow(row: any): FeedbackRecord {
  return {
    id: String(row.id),
    userId: row.user_id ?? null,
    message: String(row.message),
    response: String(row.response ?? ""),
    rating: VALID_RATING.has(row.rating) ? row.rating : "negative",
    status: VALID_STATUS.has(row.status) ? row.status : "pending",
    threadId: row.thread_id ?? null,
    timestamp: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function createFeedback(entry: {
  id: string;
  userId: string | null;
  message: string;
  response: string;
  rating: "positive" | "negative";
  threadId: string | null;
}): Promise<FeedbackRecord> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO feedback (id, user_id, message, response, rating, status, thread_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      entry.id,
      entry.userId,
      entry.message,
      entry.response,
      entry.rating,
      entry.rating === "negative" ? "pending" : "approved",
      entry.threadId,
    ]
  );
  return mapRow(result.rows[0]);
}

export async function listFeedback(status?: string): Promise<FeedbackRecord[]> {
  const pool = getPool();
  const result = status && VALID_STATUS.has(status)
    ? await pool.query(
        `SELECT * FROM feedback WHERE status = $1 ORDER BY created_at DESC`,
        [status]
      )
    : await pool.query(`SELECT * FROM feedback ORDER BY created_at DESC`);
  return result.rows.map(mapRow);
}

export async function findFeedback(id: string): Promise<FeedbackRecord | null> {
  const pool = getPool();
  const result = await pool.query(`SELECT * FROM feedback WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

export async function updateFeedbackStatus(id: string, status: "pending" | "approved" | "rejected"): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE feedback SET status = $1 WHERE id = $2 RETURNING id`,
    [status, id]
  );
  return result.rows.length > 0;
}

export async function feedbackCounts(): Promise<{ pending: number; approved: number; rejected: number }> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT status, COUNT(*) AS count FROM feedback GROUP BY status`
  );
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const row of result.rows) {
    if (VALID_STATUS.has(row.status)) {
      counts[row.status as keyof typeof counts] = Number(row.count ?? 0);
    }
  }
  return counts;
}
