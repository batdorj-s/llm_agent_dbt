/**
 * Auto Alert System
 * Monitors KPI data and generates alerts based on thresholds.
 */

import { getRawData } from "./sql.js";

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
  condition: (data: Record<string, unknown>[]) => Alert | null;
}

/**
 * Default alert rules for financial/sales data
 */
function buildDefaultRules(): AlertRule[] {
  return [
    {
      id: "negative-profit",
      type: "critical",
      category: "Санхүү",
      condition: (data) => {
        const totalProfit = data.reduce((sum, row) => {
          const profit = typeof row["Нийт ашиг"] === "number" ? row["Нийт ашиг"] : 0;
          return sum + profit;
        }, 0);
        if (totalProfit < 0) {
          return {
            id: "negative-profit-" + Date.now(),
            type: "critical",
            category: "Санхүү",
            message: `Нийт ашиг сөрөг байна: ${totalProfit.toLocaleString()}`,
            value: totalProfit,
            threshold: ">= 0",
            detectedAt: new Date().toISOString(),
          };
        }
        return null;
      },
    },
    {
      id: "low-margin",
      type: "warning",
      category: "Ашиг шимтгэл",
      condition: (data) => {
        if (data.length === 0) return null;
        const avgMargin = data.reduce((sum, row) => {
          const margin = typeof row["Ашиг шимтгэл"] === "number" ? row["Ашиг шимтгэл"] : 0;
          return sum + margin;
        }, 0) / data.length;
        if (avgMargin < 10) {
          return {
            id: "low-margin-" + Date.now(),
            type: "warning",
            category: "Ашиг шимтгэл",
            message: `Дундаж ашиг шимтгэл ${avgMargin.toFixed(1)}% байна (<10%)`,
            value: avgMargin,
            threshold: ">= 10%",
            detectedAt: new Date().toISOString(),
          };
        }
        return null;
      },
    },
    {
      id: "zero-sales",
      type: "critical",
      category: "Борлуулалт",
      condition: (data) => {
        const zeroRows = data.filter(row => {
          const amount = typeof row["Дүн"] === "number" ? row["Дүн"] : 0;
          return amount === 0;
        });
        if (zeroRows.length > data.length * 0.3) {
          return {
            id: "zero-sales-" + Date.now(),
            type: "critical",
            category: "Борлуулалт",
            message: `${zeroRows.length} мөр 0 дүнтэй байна (${((zeroRows.length / data.length) * 100).toFixed(0)}%)`,
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
      condition: (data) => {
        const totalRevenue = data.reduce((sum, row) => {
          const rev = typeof row["Орлого"] === "number" ? row["Орлого"] : (typeof row["Дүн"] === "number" ? row["Дүн"] : 0);
          return sum + rev;
        }, 0);
        const totalExpense = data.reduce((sum, row) => {
          const exp = typeof row["Зардал"] === "number" ? row["Зардал"] : 0;
          return sum + exp;
        }, 0);
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
      condition: (data) => {
        const numericCols = Object.keys(data[0] || {}).filter(k =>
          typeof data[0]?.[k] === "number"
        );
        for (const col of numericCols) {
          const values = data.map(r => r[col] as number).filter(v => !isNaN(v));
          if (values.length < 3) continue;
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
 * Scan all alerts against current data
 */
export async function scanAlerts(tableName = "raw_data"): Promise<Alert[]> {
  try {
    const data = await getRawData(tableName, 2000);
    if (!data || data.length === 0) return [];

    const rules = buildDefaultRules();
    const alerts: Alert[] = [];

    for (const rule of rules) {
      const alert = rule.condition(data);
      if (alert) alerts.push(alert);
    }

    return alerts;
  } catch {
    return [];
  }
}
