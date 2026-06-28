import { getPool } from "../db/data-lake.js";
import { findConceptColumn } from "./columnSynonyms.js";
import { detectDateColumn } from "./dateColumnHelper.js";
import { sanitizeColumnName } from "./sanitize.js";

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
    const fileCheck = await getPool().query(
      `SELECT id FROM uploaded_files WHERE type = 'dataset' AND owner_id = $1 LIMIT 1`,
      [userId]
    );
    if (fileCheck.rows.length === 0) return null;

    const catalogResult = await getPool().query(
      `SELECT table_name, columns_info FROM data_lake_catalog
       WHERE owner_id = $1
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

function buildDateWhere(dateCol: string, dateCast: string | null, startDate?: string, endDate?: string, paramOffset: number = 0): { clause: string; params: any[] } {
  if (!startDate && !endDate) return { clause: "", params: [] };
  const col = dateCast || `"${dateCol}"`;
  const clauses: string[] = [];
  const params: any[] = [];
  if (startDate) {
    clauses.push(`${col} >= $${paramOffset + params.length + 1}`);
    params.push(startDate);
  }
  if (endDate) {
    clauses.push(`${col} <= $${paramOffset + params.length + 1}`);
    params.push(endDate);
  }
  return { clause: " AND " + clauses.join(" AND "), params };
}

export async function computeMetrics(userId: string, startDate?: string, endDate?: string): Promise<ComputedMetrics | null> {
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

  const { clause: dateWhere, params: dateParams } = buildDateWhere(dateCol || "", dateCast, startDate, endDate);
  const dateLen = dateParams.length;

  if (salesCol && qtyCol) {
    try {
      const result = await getPool().query(
        `SELECT COALESCE(SUM(CAST("${salesCol}" AS NUMERIC)) / NULLIF(SUM(CAST("${qtyCol}" AS NUMERIC)), 0), 0) as aov FROM "${tableName}" WHERE 1=1${dateWhere}`,
        dateParams
      );
      aov = Number(result.rows[0]?.aov || 0);
    } catch (err) {
      console.error("[Metrics] AOV query failed:", err);
    }
  }

  if (salesCol && dateCast) {
    try {
      const { clause: filterClause, params: filterParams } = startDate && endDate
        ? buildDateWhere(dateCol || "", dateCast, startDate, endDate, 0)
        : { clause: `${dateCast} >= CURRENT_DATE - INTERVAL '60 days'`, params: [] as any[] };

      const result = await getPool().query(`
        WITH periods AS (
          SELECT
            CASE WHEN ${dateCast} >= CURRENT_DATE - INTERVAL '30 days'
              THEN 'current' ELSE 'previous'
            END AS period,
            SUM(CAST("${salesCol}" AS NUMERIC)) AS total
          FROM "${tableName}"
          WHERE ${filterClause}
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
      `, filterParams);
      growthRate = Number(result.rows[0]?.growth || 0);
    } catch (err) {
      console.error("[Metrics] Growth rate query failed:", err);
    }
  }

  if (catCol && salesCol) {
    try {
      const result = await getPool().query(
        `SELECT "${catCol}" as category, SUM(CAST("${salesCol}" AS NUMERIC)) as total
         FROM "${tableName}"
         WHERE 1=1${dateWhere}
         GROUP BY "${catCol}"
         ORDER BY total DESC LIMIT 1`,
        dateParams
      );
      if (result.rows.length > 0) {
        topCategory = String(result.rows[0].category);
        topCategoryValue = Number(result.rows[0].total || 0);
      }
    } catch (err) {
      console.error("[Metrics] Top category query failed:", err);
    }
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
