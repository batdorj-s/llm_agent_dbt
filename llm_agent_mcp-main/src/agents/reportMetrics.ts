import { getPool } from "../db/data-lake.js";
import { findConceptColumn } from "./columnSynonyms.js";

export interface ComputedMetrics {
  aov: number;
  aovUnit: string;
  growthRate: number;
  growthDirection: "up" | "down";
  topCategory: string;
  topCategoryValue: number;
  topCategoryUnit: string;
}

async function getActiveTableColumns(): Promise<{ tableName: string; columns: string[] } | null> {
  try {
    const catalogResult = await getPool().query(
      `SELECT table_name, columns_info FROM data_lake_catalog ORDER BY created_at DESC LIMIT 1`
    );
    const row = catalogResult.rows[0] as any;
    if (!row) return null;
    return {
      tableName: row.table_name,
      columns: JSON.parse(row.columns_info) as string[],
    };
  } catch {
    return null;
  }
}

export async function computeMetrics(): Promise<ComputedMetrics | null> {
  const table = await getActiveTableColumns();
  if (!table) return null;

  const { tableName, columns } = table;
  const salesCol = findConceptColumn(columns, "sales", tableName);
  const qtyCol = findConceptColumn(columns, "quantity", tableName);
  const catCol = findConceptColumn(columns, "product", tableName);
  const dateCol = findConceptColumn(columns, "date", tableName);

  let aov = 0;
  let growthRate = 0;
  let topCategory = "—";
  let topCategoryValue = 0;

  // AOV: SUM(sales) / SUM(quantity)
  if (salesCol && qtyCol) {
    try {
      const result = await getPool().query(
        `SELECT COALESCE(SUM(CAST("${salesCol}" AS NUMERIC)) / NULLIF(SUM(CAST("${qtyCol}" AS NUMERIC)), 0), 0) as aov FROM "${tableName}"`
      );
      aov = Number(result.rows[0]?.aov || 0);
    } catch {}
  }

  // Growth Rate: last 30 days vs previous 30 days
  if (salesCol && dateCol) {
    try {
      const result = await getPool().query(`
        WITH periods AS (
          SELECT
            CASE WHEN REPLACE("${dateCol}", '.', '-')::date >= CURRENT_DATE - INTERVAL '30 days'
              THEN 'current' ELSE 'previous'
            END AS period,
            SUM(CAST("${salesCol}" AS NUMERIC)) AS total
          FROM "${tableName}"
          WHERE REPLACE("${dateCol}", '.', '-')::date >= CURRENT_DATE - INTERVAL '60 days'
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

  // Top Category
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
