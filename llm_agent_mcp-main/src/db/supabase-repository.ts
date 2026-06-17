/**
 * supabase-repository.ts — Production Supabase KPI repository
 *
 * Requires environment variables:
 *   SUPABASE_URL=https://your-project.supabase.co
 *   SUPABASE_ANON_KEY=your-anon-key
 *
 * SQL setup (run in Supabase SQL editor):
 * ─────────────────────────────────────────
 * CREATE TABLE kpi_metrics (
 *   name        TEXT PRIMARY KEY,
 *   current     NUMERIC NOT NULL,
 *   target      NUMERIC NOT NULL,
 *   unit        TEXT NOT NULL,
 *   updated_at  TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * CREATE TABLE sales_history (
 *   id       SERIAL PRIMARY KEY,
 *   month    TEXT NOT NULL,
 *   revenue  NUMERIC NOT NULL
 * );
 *
 * INSERT INTO kpi_metrics VALUES
 *   ('sales',      150000, 200000, 'USD'),
 *   ('users',      1250,   1000,   'users'),
 *   ('churn_rate', 2.5,    2.0,    '%');
 *
 * INSERT INTO sales_history (month, revenue) VALUES
 *   ('January',  45000),
 *   ('February', 52000),
 *   ('March',    53000),
 *   ('April',    61000),
 *   ('May',      58000);
 * ─────────────────────────────────────────
 */

import type { IKpiRepository, KpiMetric, SalesRecord } from "./types.js";

export class SupabaseKpiRepository implements IKpiRepository {
  private supabase: any;

  constructor(supabase: any) {
    this.supabase = supabase;
  }

  async getKpi(metric: KpiMetric["name"]): Promise<KpiMetric | null> {
    const { data, error } = await this.supabase
      .from("kpi_metrics")
      .select("name, current, target, unit, updated_at")
      .eq("name", metric)
      .single();

    if (error || !data) {
      console.error("[SupabaseRepo] getKpi error:", error?.message);
      return null;
    }

    return {
      name: data.name,
      current: data.current,
      target: data.target,
      unit: data.unit,
      updatedAt: data.updated_at,
    };
  }

  async getSalesHistory(limit: number): Promise<SalesRecord[]> {
    const { data, error } = await this.supabase
      .from("sales_history")
      .select("month, revenue")
      .order("id", { ascending: true })
      .limit(limit);

    if (error || !data) {
      console.error("[SupabaseRepo] getSalesHistory error:", error?.message);
      return [];
    }

    return data.map((row: any) => ({
      month: row.month,
      revenue: row.revenue,
    }));
  }

  async updateKpiTarget(metric: KpiMetric["name"], target: number): Promise<void> {
    const { error } = await this.supabase
      .from("kpi_metrics")
      .update({ target, updated_at: new Date().toISOString() })
      .eq("name", metric);
    if (error) {
      console.error("[SupabaseRepo] updateKpiTarget error:", error.message);
    }
  }
}
