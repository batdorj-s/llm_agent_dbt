/**
 * Shared database types — repository pattern
 */

export interface KpiMetric {
  name: "sales" | "users" | "churn_rate";
  current: number;
  target: number;
  unit: string;
  updatedAt?: string;
}

export interface SalesRecord {
  month: string;
  revenue: number;
}

export interface IKpiRepository {
  getKpi(metric: KpiMetric["name"]): Promise<KpiMetric | null>;
  getSalesHistory(limit: number): Promise<SalesRecord[]>;
  updateKpiTarget(metric: KpiMetric["name"], target: number): Promise<void>;
}
