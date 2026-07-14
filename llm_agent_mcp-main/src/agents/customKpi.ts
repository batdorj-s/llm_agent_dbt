/**
 * customKpi.ts — Custom KPI definition, storage, and calculation
 *
 * Allows users to define, store, and calculate custom KPIs from existing data.
 * Supports common formula patterns and dynamic calculation.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import type { CustomKpiDefinition } from "../db/types.js";

const CUSTOM_KPIS_FILE = "./data/custom-kpis.json";

// In-memory storage with file persistence
let customKpis: CustomKpiDefinition[] = [];
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(CUSTOM_KPIS_FILE)) {
      const data = JSON.parse(readFileSync(CUSTOM_KPIS_FILE, "utf-8"));
      customKpis = Array.isArray(data) ? data : [];
    }
  } catch {
    customKpis = [];
  }
}

function persist(): void {
  try {
    const dir = "./data";
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CUSTOM_KPIS_FILE, JSON.stringify(customKpis, null, 2), "utf-8");
  } catch {
    // Best-effort persistence
  }
}

export function createCustomKpi(
  name: string,
  description: string,
  formula: string,
  parameters: Record<string, unknown> = {},
  unit: string = "",
  target?: number
): CustomKpiDefinition {
  ensureLoaded();

  const kpi: CustomKpiDefinition = {
    id: randomUUID(),
    name,
    description,
    formula,
    parameters,
    unit,
    target,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  customKpis = [...customKpis, kpi];
  persist();

  return kpi;
}

export function updateCustomKpi(
  id: string,
  updates: Partial<Pick<CustomKpiDefinition, "name" | "description" | "formula" | "parameters" | "unit" | "target">>
): CustomKpiDefinition | null {
  ensureLoaded();

  const index = customKpis.findIndex((kpi) => kpi.id === id);
  if (index === -1) return null;

  const existing = customKpis[index];
  const updated: CustomKpiDefinition = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  customKpis = [
    ...customKpis.slice(0, index),
    updated,
    ...customKpis.slice(index + 1),
  ];
  persist();

  return updated;
}

export function deleteCustomKpi(id: string): boolean {
  ensureLoaded();

  const index = customKpis.findIndex((kpi) => kpi.id === id);
  if (index === -1) return false;

  customKpis = [
    ...customKpis.slice(0, index),
    ...customKpis.slice(index + 1),
  ];
  persist();

  return true;
}

export function getCustomKpi(id: string): CustomKpiDefinition | null {
  ensureLoaded();
  return customKpis.find((kpi) => kpi.id === id) ?? null;
}

export function listCustomKpis(): CustomKpiDefinition[] {
  ensureLoaded();
  return [...customKpis];
}

export function calculateCustomKpi(
  kpi: CustomKpiDefinition,
  data: Record<string, unknown>[]
): number {
  const { formula, parameters: _parameters } = kpi;

  // Common formula patterns
  const formulaLower = formula.toLowerCase();

  // Sum pattern: sum(column)
  const sumMatch = formulaLower.match(/^sum\(([^)]+)\)$/);
  if (sumMatch) {
    const column = sumMatch[1].trim();
    return data.reduce((sum, row) => {
      const value = Number(row[column]);
      return sum + (isNaN(value) ? 0 : value);
    }, 0);
  }

  // Average pattern: avg(column) or average(column)
  const avgMatch = formulaLower.match(/^(?:avg|average)\(([^)]+)\)$/);
  if (avgMatch) {
    const column = avgMatch[1].trim();
    const values = data.map((row) => Number(row[column])).filter((v) => !isNaN(v));
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  // Count pattern: count(column) or count(*)
  const countMatch = formulaLower.match(/^count\(([^)]+)\)$/);
  if (countMatch) {
    const column = countMatch[1].trim();
    if (column === "*") return data.length;
    return data.filter((row) => row[column] !== null && row[column] !== undefined).length;
  }

  // Percentage pattern: percentage(column, condition)
  const pctMatch = formulaLower.match(/^percentage\(([^,]+),\s*([^)]+)\)$/);
  if (pctMatch) {
    const column = pctMatch[1].trim();
    const condition = pctMatch[2].trim();
    const total = data.length;
    if (total === 0) return 0;
    const matching = data.filter((row) => {
      const value = String(row[column] ?? "").toLowerCase();
      return value.includes(condition.toLowerCase());
    }).length;
    return (matching / total) * 100;
  }

  // Ratio pattern: ratio(numerator_column, denominator_column)
  const ratioMatch = formulaLower.match(/^ratio\(([^,]+),\s*([^)]+)\)$/);
  if (ratioMatch) {
    const numCol = ratioMatch[1].trim();
    const denCol = ratioMatch[2].trim();
    const numerator = data.reduce((sum, row) => sum + (Number(row[numCol]) || 0), 0);
    const denominator = data.reduce((sum, row) => sum + (Number(row[denCol]) || 0), 0);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  // Growth rate pattern: growth_rate(value_column, period_column)
  const growthMatch = formulaLower.match(/^growth_rate\(([^,]+),\s*([^)]+)\)$/);
  if (growthMatch) {
    const valueCol = growthMatch[1].trim();
    const periodCol = growthMatch[2].trim();

    // Sort by period
    const sorted = [...data].sort((a, b) => {
      const periodA = String(a[periodCol] ?? "");
      const periodB = String(b[periodCol] ?? "");
      return periodA.localeCompare(periodB);
    });

    if (sorted.length < 2) return 0;

    const firstValue = Number(sorted[0][valueCol]) || 0;
    const lastValue = Number(sorted[sorted.length - 1][valueCol]) || 0;

    return firstValue === 0 ? 0 : ((lastValue - firstValue) / firstValue) * 100;
  }

  // Simple arithmetic: value1 / value2 * 100 (for percentages)
  if (formula.includes("/") && formula.includes("*")) {
    const parts = formula.split("/").map((p) => p.trim());
    if (parts.length === 2) {
      const [numExpr, denExpr] = parts;
      const denParts = denExpr.split("*").map((p) => p.trim());
      if (denParts.length === 2 && denParts[1] === "100") {
        const numCol = numExpr.replace(/[()]/g, "").trim();
        const denCol = denParts[0].replace(/[()]/g, "").trim();
        const numerator = data.reduce((sum, row) => sum + (Number(row[numCol]) || 0), 0);
        const denominator = data.reduce((sum, row) => sum + (Number(row[denCol]) || 0), 0);
        return denominator === 0 ? 0 : (numerator / denominator) * 100;
      }
    }
  }

  // Fallback: return 0 for unrecognized formulas
  return 0;
}

export function formatCustomKpiResult(
  kpi: CustomKpiDefinition,
  value: number
): string {
  const formattedValue = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const targetInfo = kpi.target
    ? `\nЗорилтот утга: ${kpi.target.toLocaleString()} ${kpi.unit}`
    : "";

  return [
    `## ${kpi.name}`,
    "",
    `Тодорхойлолт: ${kpi.formula}`,
    `Утга: ${formattedValue} ${kpi.unit}`,
    targetInfo,
    "",
    `_Last updated: ${kpi.updatedAt}_`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Pre-defined common KPI formulas
export const COMMON_KPI_FORMULAS: Record<string, { formula: string; description: string; unit: string }> = {
  conversion_rate: {
    formula: "ratio(conversions, visitors)",
    description: "Хөрвүүлэлтийн хувь",
    unit: "%",
  },
  revenue_per_user: {
    formula: "ratio(total_revenue, user_count)",
    description: "Хэрэглэгч тутмын орлого",
    unit: "USD",
  },
  avg_order_value: {
    formula: "avg(order_total)",
    description: "Дундаж захиалгын дүн",
    unit: "USD",
  },
  churn_rate: {
    formula: "percentage(status, churned)",
    description: "Үйлчлүүлэгч алдалтын хувь",
    unit: "%",
  },
  gross_margin: {
    formula: "ratio(gross_profit, total_revenue)",
    description: "Нийт ашгийн хувь",
    unit: "%",
  },
  inventory_turnover: {
    formula: "ratio(cost_of_goods_sold, average_inventory)",
    description: "Бараа эргэлтийн давтамж",
    unit: "times",
  },
  customer_lifetime_value: {
    formula: "ratio(total_revenue, customer_count)",
    description: "Үйлчлүүлэгчийн амьдралын хугацааны үнэ цэнэ",
    unit: "USD",
  },
  employee_productivity: {
    formula: "ratio(total_revenue, employee_count)",
    description: "Ажилтны бүтээмж",
    unit: "USD/employee",
  },
};
