/**
 * Auto Alert System
 * Monitors KPI data and generates alerts based on thresholds.
 * Dynamically detects columns from the user's active dataset.
 */

import { getActiveCatalogEntry } from "../db/data-lake.js";
import { getPool } from "../db/data-lake.js";

export interface Alert {
  id: string;
  type: "critical" | "warning" | "info";
  category: string;
  message: string;
  value: number | string;
  threshold: string;
  detectedAt: string;
}

interface AlertRule {
  id: string;
  type: Alert["type"];
  category: string;
  condition: (data: Record<string, unknown>[], columns: string[]) => Alert | null;
}

/** Keywords used to identify numeric columns dynamically */
const NUMERIC_KEYWORDS = [
  /amount/i, /total/i, /sum/i, /avg/i, /revenue/i, /income/i, /profit/i,
  /expense/i, /cost/i, /sales/i, /price/i, /value/i, /quantity/i, /count/i,
  /rate/i, /score/i, /balance/i, /num/i, /дүн/i, /орлого/i, /зардал/i, /ашиг/i,
];

/** Keywords to identify potentially negative/profit-like columns (checked for negative totals) */
const PROFIT_KEYWORDS = [/profit/i, /ашиг/i, /цэвэр/i, /net/i];

/** Keywords to identify revenue/income-like columns */
const REVENUE_KEYWORDS = [/revenue/i, /income/i, /орлого/i, /борлуулалт/i, /sales/i];

/** Keywords to identify expense-like columns */
const EXPENSE_KEYWORDS = [/expense/i, /cost/i, /зардал/i, /зарлага/i, /spend/i];

export function getNumericColumns(firstRow: Record<string, unknown>): string[] {
  return Object.keys(firstRow).filter(k => NUMERIC_KEYWORDS.some(p => p.test(k)));
}

export function findColumn(columns: string[], keywords: RegExp[]): string | undefined {
  return columns.find(col => keywords.some(kw => kw.test(col)));
}

export function sumColumn(data: Record<string, unknown>[], col: string | undefined): number {
  if (!col) return 0;
  return data.reduce((sum, row) => {
    const v = typeof row[col] === "number" ? row[col] : 0;
    return sum + v;
  }, 0);
}

/**
 * Build alert rules dynamically based on available columns
 */
export function buildDefaultRules(): AlertRule[] {
  return [
    {
      id: "negative-profit",
      type: "critical",
      category: "Санхүү",
      condition: (data, columns) => {
        const profitCol = findColumn(columns, PROFIT_KEYWORDS);
        if (!profitCol) return null;
        const totalProfit = sumColumn(data, profitCol);
        if (totalProfit < 0) {
          return {
            id: "negative-profit-" + Date.now(),
            type: "critical",
            category: "Санхүү",
            message: `Нийт ашиг сөрөг байна (${profitCol}): ${totalProfit.toLocaleString()}`,
            value: totalProfit,
            threshold: ">= 0",
            detectedAt: new Date().toISOString(),
          };
        }
        return null;
      },
    },
    {
      id: "zero-values",
      type: "critical",
      category: "Борлуулалт",
      condition: (data, columns) => {
        if (data.length === 0) return null;
        const amountCol = findColumn(columns, [/amount/i, /дүн/i, /үнийн дүн/i, /value/i, /total/i]);
        if (!amountCol) return null;
        const zeroRows = data.filter(row => {
          const amount = typeof row[amountCol] === "number" ? row[amountCol] : 0;
          return amount === 0;
        });
        const zeroRatio = zeroRows.length / data.length;
        if (zeroRatio > 0.3) {
          return {
            id: "zero-values-" + Date.now(),
            type: "critical",
            category: "Борлуулалт",
            message: `${zeroRows.length} мөр 0 дүнтэй байна (${(zeroRatio * 100).toFixed(0)}%) — "${amountCol}" багана`,
            value: zeroRows.length,
            threshold: "< 30% of rows",
            detectedAt: new Date().toISOString(),
          };
        }
        return null;
      },
    },
    {
      id: "high-expense-ratio",
      type: "warning",
      category: "Зардал",
      condition: (data, columns) => {
        const revCol = findColumn(columns, REVENUE_KEYWORDS);
        const expCol = findColumn(columns, EXPENSE_KEYWORDS);
        if (!revCol || !expCol) return null;
        const totalRevenue = sumColumn(data, revCol);
        const totalExpense = sumColumn(data, expCol);
        if (totalRevenue > 0 && totalExpense / totalRevenue > 0.8) {
          return {
            id: "high-expense-" + Date.now(),
            type: "warning",
            category: "Зардал",
            message: `Зардал орлогоосоо ${((totalExpense / totalRevenue) * 100).toFixed(0)}%тай тэнцүү байна`,
            value: totalExpense / totalRevenue,
            threshold: "< 80% of revenue",
            detectedAt: new Date().toISOString(),
          };
        }
        return null;
      },
    },
    {
      id: "anomaly-zscore",
      type: "info",
      category: "Аномали",
      condition: (data, columns) => {
        if (data.length < 10) return null;
        for (const col of columns) {
          const values = data.map(r => r[col] as number).filter(v => typeof v === "number" && !isNaN(v));
          if (values.length < 10) continue;
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          const std = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
          if (std === 0) continue;
          const outliers = values.filter(v => Math.abs((v - mean) / std) > 3);
          if (outliers.length > 0) {
            return {
              id: "anomaly-" + Date.now(),
              type: "info",
              category: "Аномали",
              message: `"${col}" баганад ${outliers.length} ширхэг хэт өндөр/бага утга олдлоо`,
              value: outliers.length,
              threshold: "|z| > 3",
              detectedAt: new Date().toISOString(),
            };
          }
        }
        return null;
      },
    },
  ];
}

/**
 * Scan all alerts against the user's active dataset
 */
export async function scanAlerts(userId: string): Promise<Alert[]> {
  try {
    const entry = await getActiveCatalogEntry(userId);
    if (!entry) return [];

    const tableName = entry.table_name;
    let columnList: string[] = [];
    try { columnList = JSON.parse(entry.columns_info) as string[]; } catch {}

    const pool = getPool();
    const safeCols = columnList.map(c => `"${c.replace(/"/g, '""')}"`).join(", ");
    if (!safeCols) return [];
    const { rows } = await pool.query(`SELECT ${safeCols} FROM "${tableName}" LIMIT 2000`);
    if (!rows || rows.length === 0) return [];

    const numericCols = getNumericColumns(rows[0] as Record<string, unknown>);
    if (numericCols.length === 0) return [];

    const rules = buildDefaultRules();
    const alerts: Alert[] = [];

    for (const rule of rules) {
      const alert = rule.condition(rows, numericCols);
      if (alert) alerts.push(alert);
    }

    return alerts;
  } catch {
    return [];
  }
}
