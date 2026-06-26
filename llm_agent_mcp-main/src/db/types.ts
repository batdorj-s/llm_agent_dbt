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

export interface DateFilter {
  startDate?: string;
  endDate?: string;
}

export interface IKpiRepository {
  getKpi(metric: KpiMetric["name"], dateFilter?: DateFilter): Promise<KpiMetric | null>;
  getSalesHistory(limit: number, dateFilter?: DateFilter): Promise<SalesRecord[]>;
  updateKpiTarget(metric: KpiMetric["name"], target: number): Promise<void>;
}
