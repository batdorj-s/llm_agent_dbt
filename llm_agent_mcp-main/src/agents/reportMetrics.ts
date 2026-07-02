import { getPool, quoteIdent } from "../db/data-lake.js";
import { findConceptColumn } from "./columnSynonyms.js";
import { detectDateColumn } from "./dateColumnHelper.js";
import { sanitizeColumnName } from "./sanitize.js";
import { buildMntAmountExpr } from "../utils/sqlHelpers.js";

export interface ComputedMetrics {
  aov: number;
  aovUnit: string;
  growthRate: number;
  growthDirection: "up" | "down";
  topCategory: string;
  topCategoryValue: number;
  topCategoryUnit: string;
  isFinance: boolean;
  totalExpense: number;
  operatingProfit: number;
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
  const col = dateCast || quoteIdent(dateCol);
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
  const rawSalesCol = findConceptColumn(columns, "sales", tableName)
    || findConceptColumn(columns, "finance_amount", tableName);
  const rawQtyCol = findConceptColumn(columns, "quantity", tableName);
  // subcategory → дэлгэрэнгүй ангилал, category → үндсэн ангилал
  const rawCatCol = columns.find(c => /^subcategory$/i.test(c))
    || findConceptColumn(columns, "product", tableName)
    || findConceptColumn(columns, "finance_subcategory", tableName)
    || findConceptColumn(columns, "finance_category", tableName);
  const rawDateCol = findConceptColumn(columns, "date", tableName)
    || findConceptColumn(columns, "finance_date", tableName);
  const rawMainCatCol = columns.find(c => /^category$/i.test(c))
    || findConceptColumn(columns, "finance_category", tableName)
    || undefined;
  const isFinanceTable = !!findConceptColumn(columns, "finance_amount", tableName)
    && !!findConceptColumn(columns, "finance_category", tableName);

  const salesCol = rawSalesCol ? sanitizeColumnName(rawSalesCol) : undefined;
  const qtyCol   = rawQtyCol   ? sanitizeColumnName(rawQtyCol)   : undefined;
  const catCol   = rawCatCol   ? sanitizeColumnName(rawCatCol)   : undefined;
  const dateCol  = rawDateCol  ? sanitizeColumnName(rawDateCol)  : undefined;
  // Use MNT-safe expression for finance tables; plain CAST otherwise
  const amountExpr = (col: string) => isFinanceTable
    ? buildMntAmountExpr(quoteIdent(col))
    : `CAST(${quoteIdent(col)} AS NUMERIC)`;

  let dateCast: string | null = null;
  if (dateCol) {
    const colType = columnTypes[dateCol.toLowerCase()] || "unknown";
    const dateInfo = detectDateColumn(dateCol, colType);
    dateCast = dateInfo?.sqlCast || `CAST(${quoteIdent(dateCol)} AS DATE)`;
  }

  let aov = 0;
  let growthRate = 0;
  let topCategory = "—";
  let topCategoryValue = 0;

  const { clause: dateWhere, params: dateParams } = buildDateWhere(dateCol || "", dateCast, startDate, endDate);
  const dateLen = dateParams.length;

  if (salesCol) {
    try {
      if (isFinanceTable && rawMainCatCol) {
        // Finance: aov = total operating income (not per-transaction average)
        const result = await getPool().query(
          `SELECT COALESCE(SUM(${amountExpr(salesCol)}), 0) as aov
           FROM ${quoteIdent(tableName)}
           WHERE ${quoteIdent(rawMainCatCol)} ILIKE '%орлого%'
             AND ${quoteIdent(rawMainCatCol)} NOT ILIKE '%зээл%'
             ${dateWhere}`,
          dateParams
        );
        aov = Number(result.rows[0]?.aov || 0);
      } else {
        const incomeCond = rawMainCatCol
          ? ` AND (${quoteIdent(rawMainCatCol)} LIKE '%Орлого%' OR ${quoteIdent(rawMainCatCol)} LIKE '%орлого%')`
          : (qtyCol ? ` AND CAST(${quoteIdent(qtyCol)} AS NUMERIC) > 0` : "");
        const result = await getPool().query(
          `SELECT COALESCE(SUM(${amountExpr(salesCol)}) / NULLIF(COUNT(*), 0), 0) as aov
           FROM ${quoteIdent(tableName)}
           WHERE 1=1${dateWhere}${incomeCond}`,
          dateParams
        );
        aov = Number(result.rows[0]?.aov || 0);
      }
    } catch (err) {
      console.error("[Metrics] AOV query failed:", err);
    }
  }

  if (salesCol && dateCast) {
    try {
      let filterClause: string;
      let filterParams: any[];

      if (startDate && endDate) {
        ({ clause: filterClause, params: filterParams } = buildDateWhere(dateCol || "", dateCast, startDate, endDate, 0));
      } else if (isFinanceTable && rawMainCatCol) {
        // Finance: month-over-month growth using the data's own last 2 months
        filterClause = `${dateCast} >= DATE_TRUNC('month', (SELECT MAX(${dateCast}) FROM ${quoteIdent(tableName)})) - INTERVAL '1 month'`;
        filterParams = [];
      } else {
        filterClause = `${dateCast} >= CURRENT_DATE - INTERVAL '60 days'`;
        filterParams = [];
      }

      const incomeCond = (isFinanceTable && rawMainCatCol)
        ? ` AND ${quoteIdent(rawMainCatCol)} ILIKE '%орлого%' AND ${quoteIdent(rawMainCatCol)} NOT ILIKE '%зээл%'`
        : "";
      const periodExpr = (isFinanceTable && dateCast)
        ? `CASE WHEN DATE_TRUNC('month', ${dateCast}) = DATE_TRUNC('month', (SELECT MAX(${dateCast}) FROM ${quoteIdent(tableName)})) THEN 'current' ELSE 'previous' END`
        : `CASE WHEN ${dateCast} >= CURRENT_DATE - INTERVAL '30 days' THEN 'current' ELSE 'previous' END`;

      const result = await getPool().query(`
        WITH periods AS (
          SELECT ${periodExpr} AS period,
            SUM(${amountExpr(salesCol)}) AS total
          FROM ${quoteIdent(tableName)}
          WHERE ${filterClause}${incomeCond}
          GROUP BY period
        )
        SELECT COALESCE(
          (MAX(CASE WHEN period = 'current' THEN total END) -
           MAX(CASE WHEN period = 'previous' THEN total END)) /
          NULLIF(MAX(CASE WHEN period = 'previous' THEN total END), 0) * 100,
          0
        ) as growth FROM periods
      `, filterParams);
      growthRate = Number(result.rows[0]?.growth || 0);
    } catch (err) {
      console.error("[Metrics] Growth rate query failed:", err);
    }
  }

  if (catCol && salesCol) {
    try {
      let topCatQuery: string;
      if (isFinanceTable && rawMainCatCol) {
        // Finance: top operating expense subcategory (exclude loan repayments)
        const subCatQuoted = quoteIdent(catCol);
        topCatQuery = `
          SELECT ${subCatQuoted} as category, SUM(${amountExpr(salesCol)}) as total
          FROM ${quoteIdent(tableName)}
          WHERE ${quoteIdent(rawMainCatCol)} ILIKE '%зарлага%'
            AND ${subCatQuoted} NOT ILIKE '%зээл%'
            AND ${subCatQuoted} IS NOT NULL
            ${dateWhere}
          GROUP BY ${subCatQuoted}
          ORDER BY total DESC LIMIT 1`;
      } else {
        const expenseCond = rawMainCatCol
          ? ` AND (${quoteIdent(rawMainCatCol)} LIKE '%Зарлага%' OR ${quoteIdent(rawMainCatCol)} LIKE '%зарлага%' OR ${quoteIdent(rawMainCatCol)} LIKE '%Expense%' OR ${quoteIdent(rawMainCatCol)} LIKE '%expense%')`
          : "";
        topCatQuery = `
          SELECT ${quoteIdent(catCol)} as category, SUM(${amountExpr(salesCol)}) as total
          FROM ${quoteIdent(tableName)}
          WHERE 1=1${dateWhere}${expenseCond}
          GROUP BY ${quoteIdent(catCol)}
          ORDER BY total DESC LIMIT 1`;
      }
      const result = await getPool().query(topCatQuery, dateParams);
      if (result.rows.length > 0) {
        topCategory = String(result.rows[0].category);
        topCategoryValue = Number(result.rows[0].total || 0);
      }
    } catch (err) {
      console.error("[Metrics] Top category query failed:", err);
    }
  }

  // For finance tables: compute total operating expense and operating profit
  let totalExpense = 0;
  if (salesCol && isFinanceTable && rawMainCatCol) {
    try {
      const rawSubCatCol = findConceptColumn(columns, "finance_subcategory", tableName);
      const opExpenseWhere = rawSubCatCol
        ? `${quoteIdent(rawMainCatCol)} ILIKE '%зарлага%' AND ${quoteIdent(rawSubCatCol)} NOT ILIKE '%зээл%' AND ${quoteIdent(rawSubCatCol)} NOT ILIKE '%бусад%'`
        : `${quoteIdent(rawMainCatCol)} ILIKE '%зарлага%'`;
      const expResult = await getPool().query(
        `SELECT COALESCE(SUM(${amountExpr(salesCol)}), 0) AS total_expense
         FROM ${quoteIdent(tableName)}
         WHERE ${opExpenseWhere}${dateWhere}`,
        dateParams
      );
      totalExpense = Math.round(Number(expResult.rows[0]?.total_expense || 0));
    } catch (err) {
      console.error("[Metrics] totalExpense query failed:", err);
    }
  }

  const totalIncomeForCalc = isFinanceTable ? Math.round(aov * 100) / 100 : 0;
  const operatingProfit = isFinanceTable ? Math.round((aov - totalExpense) * 100) / 100 : 0;

  return {
    aov: isFinanceTable ? operatingProfit : Math.round(aov * 100) / 100,
    aovUnit: "₮",
    growthRate: Math.round(growthRate * 100) / 100,
    growthDirection: growthRate >= 0 ? "up" : "down",
    topCategory,
    topCategoryValue: Math.round(topCategoryValue * 100) / 100,
    topCategoryUnit: "₮",
    isFinance: isFinanceTable,
    totalExpense: Math.round(totalExpense * 100) / 100,
    operatingProfit,
  };
}
