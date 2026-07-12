/**
 * Simple SQL utilities for data export and alerts.
 */

import { getPool, isPgAvailable, quoteIdent } from "../db/data-lake.js";

/**
 * Fetch raw rows from a table (up to `limit` rows).
 * Returns [] if PG is unavailable.
 */
export async function getRawData(
  tableName: string,
  limit = 5000
): Promise<Record<string, unknown>[]> {
  if (!isPgAvailable()) return [];
  const pool = getPool();
  try {
    const result = await pool.query(
      `SELECT * FROM ${quoteIdent(tableName)} LIMIT ${Math.min(limit, 10000)}`
    );
    return result.rows as Record<string, unknown>[];
  } catch {
    return [];
  }
}
