"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { KpiData, SalesHistory, ComputedMetrics, ServerStatus } from "../components/types";

export interface FinanceAudit {
  available: boolean;
  tableName?: string;
  incomeRows?: number;
  expenseRows?: number;
  noiseRows?: number;
  unclassifiedRows?: number;
  totalRows?: number;
  incomeTotal?: number;
  expenseTotal?: number;
}

export interface TablePassport {
  available: boolean;
  tableName?: string;
  questions?: string[];
  domain?: string;
  industry?: string;
}

export type Period = "7d" | "1m" | "3m" | "6m" | "12m" | "all";

function periodToDateRange(p: Period): { startDate?: string; endDate?: string } {
  const now = new Date();
  const end = now.toISOString().split("T")[0];
  const start = new Date(now);
  switch (p) {
    case "7d":  start.setDate(start.getDate() - 7);    break;
    case "1m":  start.setMonth(start.getMonth() - 1);  break;
    case "3m":  start.setMonth(start.getMonth() - 3);  break;
    case "6m":  start.setMonth(start.getMonth() - 6);  break;
    case "12m": start.setMonth(start.getMonth() - 12); break;
    case "all": return {};
  }
  return { startDate: start.toISOString().split("T")[0], endDate: end };
}

export function periodToHistoryLimit(p: Period): number {
  switch (p) {
    case "7d":  return 7;
    case "1m":  return 30;
    case "3m":  return 90;
    case "6m":  return 180;
    case "12m": return 365;
    case "all": return 12;
  }
}

function buildQs(period: Period): string {
  const dr = periodToDateRange(period);
  const params = new URLSearchParams();
  params.set("limit", String(periodToHistoryLimit(period)));
  if (dr.startDate) params.set("startDate", dr.startDate);
  if (dr.endDate)   params.set("endDate",   dr.endDate);
  return params.toString();
}

async function fetchJson<T>(url: string, token: string, onUnauthorized: () => void): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { onUnauthorized(); throw new Error("Unauthorized"); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function useDashboard(
  token: string | null,
  isLoggedIn: boolean,
  onUnauthorized: () => void,
  period: Period,
  setPeriod: (p: Period) => void,
) {
  const qs = buildQs(period);
  const enabled = isLoggedIn && !!token;

  const { data: serverStatus } = useQuery<ServerStatus>({
    queryKey: ["serverStatus"],
    queryFn: async () => {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: salesKpi } = useQuery<KpiData>({
    queryKey: ["kpi", "sales", qs],
    queryFn: () => fetchJson(`/api/kpi/sales?${qs}`, token!, onUnauthorized),
    enabled,
  });

  const { data: usersKpi } = useQuery<KpiData>({
    queryKey: ["kpi", "users", qs],
    queryFn: () => fetchJson(`/api/kpi/users?${qs}`, token!, onUnauthorized),
    enabled,
  });

  const { data: churnKpi } = useQuery<KpiData>({
    queryKey: ["kpi", "churn_rate", qs],
    queryFn: () => fetchJson(`/api/kpi/churn_rate?${qs}`, token!, onUnauthorized),
    enabled,
  });

  const { data: salesHistory = [] } = useQuery<SalesHistory[]>({
    queryKey: ["kpiHistory", qs],
    queryFn: () => fetchJson(`/api/kpi-history?${qs}`, token!, onUnauthorized),
    enabled,
  });

  const { data: computedMetrics } = useQuery<ComputedMetrics>({
    queryKey: ["computedMetrics", qs],
    queryFn: () => fetchJson(`/api/dashboard/computed-metrics?${qs}`, token!, onUnauthorized),
    enabled,
  });

  const { data: financeCharts } = useQuery<any>({
    queryKey: ["financeCharts"],
    queryFn: () => fetchJson(`/api/finance-charts`, token!, onUnauthorized),
    enabled,
  });

  const { data: financeAudit } = useQuery<FinanceAudit>({
    queryKey: ["financeAudit"],
    queryFn: () => fetchJson(`/api/finance-audit`, token!, onUnauthorized),
    enabled,
    staleTime: 60_000,
  });

  const { data: tablePassport } = useQuery<TablePassport>({
    queryKey: ["tablePassport"],
    queryFn: () => fetchJson(`/api/table-passport`, token!, onUnauthorized),
    enabled,
    staleTime: 5 * 60_000,
  });

  // isDashboardLoading: true while any primary KPI query is pending on first load
  const isDashboardLoading = enabled && (
    salesKpi === undefined || usersKpi === undefined || churnKpi === undefined
  );

  const queryClient = useQueryClient();
  const fetchDashboardData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["kpi"] });
    queryClient.invalidateQueries({ queryKey: ["kpiHistory"] });
    queryClient.invalidateQueries({ queryKey: ["computedMetrics"] });
    queryClient.invalidateQueries({ queryKey: ["financeCharts"] });
    queryClient.invalidateQueries({ queryKey: ["financeAudit"] });
    queryClient.invalidateQueries({ queryKey: ["tablePassport"] });
  }, [queryClient]);

  const resetDashboard = useCallback(() => {
    queryClient.removeQueries({ queryKey: ["kpi"] });
    queryClient.removeQueries({ queryKey: ["kpiHistory"] });
    queryClient.removeQueries({ queryKey: ["computedMetrics"] });
    queryClient.removeQueries({ queryKey: ["financeCharts"] });
    queryClient.removeQueries({ queryKey: ["financeAudit"] });
    queryClient.removeQueries({ queryKey: ["tablePassport"] });
  }, [queryClient]);

  return {
    serverStatus: serverStatus ?? null,
    salesKpi: salesKpi ?? null,
    usersKpi: usersKpi ?? null,
    churnKpi: churnKpi ?? null,
    computedMetrics: computedMetrics ?? null,
    salesHistory,
    financeCharts: financeCharts ?? null,
    financeAudit: financeAudit ?? null,
    tablePassport: tablePassport ?? null,
    isDashboardLoading,
    period,
    setPeriod,
    fetchDashboardData,
    resetDashboard,
  };
}
