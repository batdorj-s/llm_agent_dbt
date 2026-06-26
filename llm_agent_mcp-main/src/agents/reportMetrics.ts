import { getPool } from "../db/data-lake.js";
import { findConceptColumn } from "./columnSynonyms.js";
import { detectDateColumn } from "./dateColumnHelper.js";

export interface ComputedMetrics {
  aov: number;
  aovUnit: string;
  growthRate: number;
  growthDirection: "up" | "down";
  topCategory: string;
  topCategoryValue: number;
  topCategoryUnit: string;
}

async function getActiveTableInfo(userId: string): Promise<{
  tableName: string;
  columns: string[];
  columnTypes: Record<string, string>;
} | null> {
  try {
    const catalogResult = await getPool().query(
      `SELECT table_name, columns_info FROM data_lake_catalog
       WHERE visibility = 'shared' OR owner_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    const row = catalogResult.rows[0] as any;
    if (!row) return null;

    const columns = JSON.parse(row.columns_info) as string[];

    const typeResult = await getPool().query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = 'public'`,
      [row.table_name]
    );
    const columnTypes: Record<string, string> = {};
    for (const r of typeResult.rows as Array<{ column_name: string; data_type: string }>) {
      columnTypes[r.column_name.toLowerCase()] = r.data_type;
    }

    return { tableName: row.table_name, columns, columnTypes };
  } catch {
    return null;
  }
}

export async function computeMetrics(userId: string): Promise<ComputedMetrics | null> {
  const table = await getActiveTableInfo(userId);
  if (!table) return null;

  const { tableName, columns, columnTypes } = table;
  const salesCol = findConceptColumn(columns, "sales", tableName);
  const qtyCol = findConceptColumn(columns, "quantity", tableName);
  const catCol = findConceptColumn(columns, "product", tableName);
  const dateCol = findConceptColumn(columns, "date", tableName);

  let dateCast: string | null = null;
  if (dateCol) {
    const colType = columnTypes[dateCol.toLowerCase()] || "unknown";
    const dateInfo = detectDateColumn(dateCol, colType);
    dateCast = dateInfo?.sqlCast || `CAST("${dateCol}" AS DATE)`;
  }

  let aov = 0;
  let growthRate = 0;
  let topCategory = "—";
  let topCategoryValue = 0;

  if (salesCol && qtyCol) {
    try {
      const result = await getPool().query(
        `SELECT COALESCE(SUM(CAST("${salesCol}" AS NUMERIC)) / NULLIF(SUM(CAST("${qtyCol}" AS NUMERIC)), 0), 0) as aov FROM "${tableName}"`
      );
      aov = Number(result.rows[0]?.aov || 0);
    } catch {}
  }

  if (salesCol && dateCast) {
    try {
      const result = await getPool().query(`
        WITH periods AS (
          SELECT
            CASE WHEN ${dateCast} >= CURRENT_DATE - INTERVAL '30 days'
              THEN 'current' ELSE 'previous'
            END AS period,
            SUM(CAST("${salesCol}" AS NUMERIC)) AS total
          FROM "${tableName}"
          WHERE ${dateCast} >= CURRENT_DATE - INTERVAL '60 days'
          GROUP BY period
        )
        SELECT
          COALESCE(
            (MAX(CASE WHEN period = 'current' THEN total END) -
             MAX(CASE WHEN period = 'previous' THEN total END)) /
            NULLIF(MAX(CASE WHEN period = 'previous' THEN total END), 0) * 100,
            0
          ) as growth
        FROM periods
      `);
      growthRate = Number(result.rows[0]?.growth || 0);
    } catch {}
  }

  if (catCol && salesCol) {
    try {
      const result = await getPool().query(
        `SELECT "${catCol}" as category, SUM(CAST("${salesCol}" AS NUMERIC)) as total
         FROM "${tableName}"
         GROUP BY "${catCol}"
         ORDER BY total DESC LIMIT 1`
      );
      if (result.rows.length > 0) {
        topCategory = String(result.rows[0].category);
        topCategoryValue = Number(result.rows[0].total || 0);
      }
    } catch {}
  }

  return {
    aov: Math.round(aov * 100) / 100,
    aovUnit: "$",
    growthRate: Math.round(growthRate * 100) / 100,
    growthDirection: growthRate >= 0 ? "up" : "down",
    topCategory,
    topCategoryValue: Math.round(topCategoryValue * 100) / 100,
    topCategoryUnit: "$",
  };
}
