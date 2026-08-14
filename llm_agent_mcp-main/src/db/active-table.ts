/**
 * active-table.ts — single source of truth for resolving a user's active
 * data-lake table. Previously duplicated in sqlite-repository.ts and
 * reportMetrics.ts; both now consume this module.
 */
import { getPool } from "../db/data-lake.js";

export interface ActiveTableInfo {
  tableName: string;
  columns: string[];
  columnTypes: Record<string, string>;
}

/**
 * Resolves the most recent data-lake table for a user.
 *
 * @param userId   owner filter; when omitted, the newest table overall is used
 * @param accept   optional predicate — when provided, the newest table passing
 *                 the predicate is returned instead of strictly the newest
 */
export async function getActiveTableInfo(
  userId?: string,
  accept?: (info: ActiveTableInfo) => boolean
): Promise<ActiveTableInfo | null> {
  try {
    const pool = getPool();
    if (userId) {
      const fileCheck = await pool.query(
        `SELECT id FROM uploaded_files WHERE type = 'dataset' AND owner_id = $1 LIMIT 1`,
        [userId]
      );
      if (fileCheck.rows.length === 0) return null;
    }

    const catalogResult = await pool.query(
      userId
        ? `SELECT table_name, columns_info FROM data_lake_catalog
           WHERE owner_id = $1 ORDER BY created_at DESC`
        : `SELECT table_name, columns_info FROM data_lake_catalog
           ORDER BY created_at DESC`,
      userId ? [userId] : []
    );
    if (catalogResult.rows.length === 0) return null;

    for (const row of catalogResult.rows as Array<any>) {
      let columns: string[];
      try {
        columns = JSON.parse(row.columns_info) as string[];
      } catch {
        continue;
      }
      if (columns.length === 0) continue;

      const typeResult = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_name = $1 AND table_schema = 'public'`,
        [row.table_name]
      );
      const columnTypes: Record<string, string> = {};
      for (const r of typeResult.rows as Array<{ column_name: string; data_type: string }>) {
        columnTypes[r.column_name.toLowerCase()] = r.data_type;
      }

      const info: ActiveTableInfo = { tableName: row.table_name, columns, columnTypes };
      if (!accept || accept(info)) return info;
    }

    return null;
  } catch {
    return null;
  }
}

/** True when the column's data type is numeric-ish (money, int, float, ...). */
export function isNumericType(columnTypes: Record<string, string>, column: string): boolean {
  const t = columnTypes[column.toLowerCase()];
  return !!t && /numeric|integer|double|real|float|money|dec/i.test(t);
}
