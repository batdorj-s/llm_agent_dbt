/**
 * mock-repository.ts — In-memory KPI repository (no external DB needed)
 *
 * Drop-in replacement for Supabase when DB credentials are unavailable.
 * Swap out by changing the export in kpi-repository.ts.
 */

import type { IKpiRepository, KpiMetric, SalesRecord } from "./types.js";

const KPI_DATA: Record<KpiMetric["name"], KpiMetric> = {
  sales: {
    name: "sales",
    current: 150000,
    target: 200000,
    unit: "USD",
    updatedAt: new Date().toISOString(),
  },
  users: {
    name: "users",
    current: 1250,
    target: 1000,
    unit: "users",
    updatedAt: new Date().toISOString(),
  },
  churn_rate: {
    name: "churn_rate",
    current: 2.5,
    target: 2.0,
    unit: "%",
    updatedAt: new Date().toISOString(),
  },
};

const SALES_HISTORY: SalesRecord[] = [
  { month: "January", revenue: 45000 },
  { month: "February", revenue: 52000 },
  { month: "March", revenue: 53000 },
  { month: "April", revenue: 61000 },
  { month: "May", revenue: 58000 },
];

export class MockKpiRepository implements IKpiRepository {
  async getKpi(metric: KpiMetric["name"]): Promise<KpiMetric | null> {
    return KPI_DATA[metric] ?? null;
  }

  async getSalesHistory(limit: number): Promise<SalesRecord[]> {
    return SALES_HISTORY.slice(0, limit);
  }

  async updateKpiTarget(metric: KpiMetric["name"], target: number): Promise<void> {
    if (KPI_DATA[metric]) {
      KPI_DATA[metric].target = target;
      KPI_DATA[metric].updatedAt = new Date().toISOString();
    }
  }
}
