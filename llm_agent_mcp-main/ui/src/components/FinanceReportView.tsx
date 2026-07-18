"use client";

import React, { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Area, AreaChart,
} from "recharts";
import { FileText, Download, FileSpreadsheet } from "lucide-react";

interface FinanceChart {
  id: string;
  title: string;
  type: string;
  data: { label: string; value: number; value2?: number; [k: string]: any }[];
  config: Record<string, unknown>;
}

interface FinanceChartsResponse {
  isFinance: boolean;
  tableName?: string;
  charts?: FinanceChart[];
  summary?: {
    totalIncome: number;
    totalExpense: number;
    operatingProfit: number;
  };
}

interface ComputedMetrics {
  aov?: number;
  growthRate?: number;
  growthDirection?: "up" | "down";
  topCategory?: string;
  totalExpense?: number;
  operatingProfit?: number;
}

interface IncomeStatementRow {
  subcategory: string;
  amount: number;
}

interface IncomeStatementReport {
  incomeRows: IncomeStatementRow[];
  expenseRows: IncomeStatementRow[];
  totalIncome: number;
  totalExpense: number;
  operatingProfit: number;
}

interface ExpenseBreakdownRow {
  category: string;
  monthly: number[];
  total: number;
  pct: number;
}

interface ExpenseBreakdownReport {
  categories: string[];
  months: string[];
  rows: ExpenseBreakdownRow[];
  grandTotal: number;
}

interface CashFlowItem {
  name: string;
  amount: number;
}

interface CashFlowSection {
  name: string;
  items: CashFlowItem[];
  subtotal: number;
}

interface CashFlowReport {
  sections: CashFlowSection[];
  netCashFlow: number;
}

interface FinanceReportsResponse {
  isFinance: boolean;
  incomeStatement: IncomeStatementReport | null;
  expenseBreakdown: ExpenseBreakdownReport | null;
  cashFlow: CashFlowReport | null;
}

function SkeletonLine({ width }: { width: string }) {
  return <div className="h-3 bg-foreground/10 rounded animate-pulse" style={{ width }} />;
}

function ReportSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <SkeletonLine width="180px" />
        <div className="flex gap-2">
          <SkeletonLine width="80px" />
          <SkeletonLine width="80px" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div className="h-20 bg-foreground/5 rounded animate-pulse" />
        <div className="h-20 bg-foreground/5 rounded animate-pulse" />
        <div className="h-20 bg-foreground/5 rounded animate-pulse" />
        <div className="h-20 bg-foreground/5 rounded animate-pulse" />
      </div>
      <div className="h-48 bg-foreground/5 rounded animate-pulse" />
    </div>
  );
}

function ExportButton({ label, endpoint, icon }: { label: string; endpoint: string; icon: React.ReactNode }) {
  const [isExporting, setIsExporting] = useState(false);
  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `finance-report-${new Date().toISOString().split("T")[0]}.${label.toLowerCase()}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Экспорт амжилтгүй боллоо.");
    } finally {
      setIsExporting(false);
    }
  };
  return (
    <button
      onClick={handleExport}
      disabled={isExporting}
      className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded border border-border bg-card text-foreground/70 hover:bg-foreground/5 hover:text-foreground transition-all cursor-pointer disabled:opacity-50"
    >
      {icon}
      {isExporting ? "..." : label}
    </button>
  );
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

const formatCurrency = (value: number) =>
  `₮${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function deriveReportsFromCharts(data: FinanceChartsResponse): FinanceReportsResponse | null {
  if (!data?.charts || data.charts.length === 0) return null;
  const summary = data.summary;
  const findChart = (id: string) => data.charts?.find(c => c.id === id);

  const incStatementChart = findChart("income_statement");
  const expMonthlyChart = findChart("expense_breakdown_monthly");
  const cashflowChart = findChart("cashflow_summary");

  let incomeStatement: IncomeStatementReport | null = null;
  let expenseBreakdown: ExpenseBreakdownReport | null = null;
  let cashFlow: CashFlowReport | null = null;

  // 1. Income Statement from income_statement chart data
  if (incStatementChart?.data && incStatementChart.data.length > 0) {
    const incomeRows: IncomeStatementRow[] = [];
    const expenseRows: IncomeStatementRow[] = [];
    for (const row of incStatementChart.data) {
      const inc = Number(row["Орлого"] ?? 0);
      const exp = Number(row["Зарлага"] ?? 0);
      if (inc > 0) incomeRows.push({ subcategory: row.label, amount: inc });
      if (exp > 0) expenseRows.push({ subcategory: row.label, amount: exp });
    }
    if (incomeRows.length > 0 || expenseRows.length > 0) {
      incomeStatement = {
        incomeRows,
        expenseRows,
        totalIncome: summary?.totalIncome ?? incomeRows.reduce((s, r) => s + r.amount, 0),
        totalExpense: summary?.totalExpense ?? expenseRows.reduce((s, r) => s + r.amount, 0),
        operatingProfit: summary?.operatingProfit ?? 0,
      };
    }
  }

  // 2. Expense Breakdown from expense_breakdown_monthly chart data
  if (expMonthlyChart?.data && (expMonthlyChart as any).config?.series) {
    const series = (expMonthlyChart as any).config.series as string[];
    const months = expMonthlyChart.data.map((d: any) => d.label);
    const rows: ExpenseBreakdownRow[] = series.map((cat, i) => {
      const monthly = months.map((m: string) => {
        const row = expMonthlyChart.data.find((d: any) => d.label === m);
        return Math.round(Number(row?.[cat] ?? 0));
      });
      const total = monthly.reduce((s, v) => s + v, 0);
      return { category: cat, monthly, total, pct: 0 };
    });
    const grandTotal = rows.reduce((s, r) => s + r.total, 0);
    if (grandTotal > 0) {
      for (const row of rows) row.pct = Math.round((row.total / grandTotal) * 1000) / 10;
      expenseBreakdown = { categories: series, months, rows, grandTotal };
    }
  }

  // 3. Cash Flow from cashflow_summary chart data (split into in/out by sign)
  if (cashflowChart?.data && (cashflowChart as any).config?.series) {
    const series = (cashflowChart as any).config.series as string[];
    const monthEntries = cashflowChart.data as any[];
    // Aggregate totals per subcategory across all months
    const subcatTotals: Record<string, number> = {};
    for (const entry of monthEntries) {
      for (const s of series) {
        subcatTotals[s] = (subcatTotals[s] || 0) + Math.round(Number(entry[s] ?? 0));
      }
    }
    // Match subcats from expense_breakdown_monthly to determine in/out
    const expenseSubcats = new Set(expenseBreakdown?.rows.map(r => r.category) ?? []);
    const inflowItems: CashFlowItem[] = [];
    const outflowItems: CashFlowItem[] = [];
    for (const [name, total] of Object.entries(subcatTotals)) {
      if (expenseSubcats.has(name)) {
        outflowItems.push({ name, amount: total });
      } else {
        inflowItems.push({ name, amount: total });
      }
    }
    const sections: CashFlowSection[] = [];
    if (inflowItems.length > 0) {
      sections.push({
        name: "Үйл ажиллагааны орлого",
        items: inflowItems,
        subtotal: inflowItems.reduce((s, r) => s + r.amount, 0),
      });
    }
    if (outflowItems.length > 0) {
      const outTotal = outflowItems.reduce((s, r) => s + r.amount, 0);
      sections.push({
        name: "Үйл ажиллагааны зарлага",
        items: outflowItems,
        subtotal: -outTotal,
      });
    }
    if (sections.length > 0) {
      const inflowTotal = sections.filter(s => s.subtotal >= 0).reduce((s, sec) => s + sec.subtotal, 0);
      const outflowTotal = sections.filter(s => s.subtotal < 0).reduce((s, sec) => s + Math.abs(sec.subtotal), 0);
      cashFlow = { sections, netCashFlow: inflowTotal - outflowTotal };
    }
  }

  if (!incomeStatement && !expenseBreakdown && !cashFlow) return null;
  return { isFinance: true, incomeStatement, expenseBreakdown, cashFlow };
}

export const FinanceReportView = () => {
  const [data, setData] = useState<FinanceChartsResponse | null>(null);
  const [metrics, setMetrics] = useState<ComputedMetrics | null>(null);
  const [reports, setReports] = useState<FinanceReportsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    Promise.all([
      fetch("/api/finance-charts"),
      fetch("/api/dashboard/computed-metrics"),
      fetch("/api/finance-reports"),
    ]).then(async ([chartsRes, metricsRes, reportsRes]) => {
      if (cancelled) return;
      const [chartsData, metricsData, reportsData] = await Promise.all([
        chartsRes.ok ? chartsRes.json() : null,
        metricsRes.ok ? metricsRes.json() : null,
        reportsRes.ok ? reportsRes.json() : null,
      ]);
      if (!cancelled) {
        setData(chartsData);
        setMetrics(metricsData);
        setReports(reportsData ?? (chartsData ? deriveReportsFromCharts(chartsData) : null));
        setIsLoading(false);
      }
    }).catch(() => {
      if (!cancelled) { setError("Тайлангийн өгөгдөл ачаалахад алдаа гарлаа."); setIsLoading(false); }
    });

    return () => { cancelled = true; };
  }, []);

  if (isLoading) return <ReportSkeleton />;
  if (error) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs text-red-500">{error}</p>
    </div>
  );
  if (!data?.isFinance) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs text-foreground/50">Тайланд харуулах санхүүгийн өгөгдөл байхгүй. Эхлээд өгөгдлийн сангаа асаана уу.</p>
    </div>
  );

  const { summary, charts } = data;
  const monthlyChart = charts?.find(c => c.id === "monthly_cashflow");
  const expenseChart = charts?.find(c => c.id === "category_breakdown");
  const incomeChart = charts?.find(c => c.id === "top_parties");
  const dailyTrend = charts?.find(c => c.id === "daily_trend");

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* HEADER */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-sm font-bold text-foreground flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Санхүүгийн тайлан
            </h1>
            <p className="text-[10px] text-foreground/50 mt-1">
              Үүсгэсэн: {new Date().toLocaleDateString("mn-MN", { year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExportButton label="PDF" endpoint="/api/report/export-pdf" icon={<Download className="w-3 h-3" />} />
            <ExportButton label="Excel" endpoint="/api/report/export-xlsx" icon={<FileSpreadsheet className="w-3 h-3" />} />
          </div>
        </div>

        {/* KPI SUMMARY CARDS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border border-border/80 rounded-xl p-4 bg-card">
            <p className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Нийт орлого</p>
            <p className="text-lg font-extrabold text-foreground mt-1" style={{ color: "#3b82f6" }}>
              {summary ? formatCurrency(summary.totalIncome) : "—"}
            </p>
          </div>
          <div className="border border-border/80 rounded-xl p-4 bg-card">
            <p className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Нийт зарлага</p>
            <p className="text-lg font-extrabold text-foreground mt-1" style={{ color: "#ef4444" }}>
              {summary ? formatCurrency(summary.totalExpense) : "—"}
            </p>
          </div>
          <div className="border border-border/80 rounded-xl p-4 bg-card">
            <p className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">ҮА ашиг/алдагдал</p>
            <p className={`text-lg font-extrabold mt-1 ${summary && summary.operatingProfit >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {summary ? formatCurrency(summary.operatingProfit) : "—"}
            </p>
          </div>
          <div className="border border-border/80 rounded-xl p-4 bg-card">
            <p className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Өсөлт</p>
            <p className={`text-lg font-extrabold mt-1 ${metrics?.growthDirection === "up" ? "text-emerald-500" : "text-red-500"}`}>
              {metrics?.growthRate != null ? `${metrics.growthDirection === "up" ? "+" : ""}${metrics.growthRate.toFixed(1)}%` : "—"}
            </p>
          </div>
        </div>

        {/* MONTHLY INCOME VS EXPENSE CHART */}
        {monthlyChart && (
          <div className="border border-border/80 rounded-xl bg-card p-5">
            <h2 className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider mb-4">Сарын орлого / зарлага</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyChart.data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e2e8f0)" vertical={false} strokeOpacity={0.6} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-foreground)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--color-foreground)" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`} />
                <Tooltip
                  formatter={(value, name) => [formatCurrency(Number(value) || 0), name === "Орлого" ? "Орлого" : "Зарлага"]}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid var(--color-border)", backgroundColor: "var(--color-card)" }}
                  cursor={{ fill: "var(--color-foreground)", fillOpacity: 0.04 }}
                />
                <Bar dataKey="Орлого" fill="#10b981" fillOpacity={0.85} radius={[4, 4, 0, 0]} maxBarSize={32} name="Орлого" />
                <Bar dataKey="Зарлага" fill="#ef4444" fillOpacity={0.85} radius={[4, 4, 0, 0]} maxBarSize={32} name="Зарлага" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* EXPENSE BREAKDOWN TABLE + INCOME SOURCES */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Expense breakdown */}
          <div className="border border-border/80 rounded-xl bg-card overflow-hidden">
            <div className="p-4 border-b border-border/80">
              <h2 className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Зарлагын ангилал</h2>
            </div>
            {expenseChart?.data && expenseChart.data.length > 0 ? (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border/80 text-[10px] text-foreground/50 uppercase tracking-wider">
                    <th className="text-left p-3 font-semibold">Ангилал</th>
                    <th className="text-right p-3 font-semibold">Дүн</th>
                    <th className="text-right p-3 font-semibold">Эзлэх хувь</th>
                  </tr>
                </thead>
                <tbody>
                  {expenseChart.data.map((row: any, i: number) => {
                    const total = expenseChart.data.reduce((s: number, r: any) => s + Number(r.value ?? 0), 0);
                    const pct = total > 0 ? ((Number(row.value ?? 0) / total) * 100).toFixed(1) : "0";
                    return (
                      <tr key={row.label} className="border-b border-border/40 hover:bg-foreground/5 transition-colors">
                        <td className="p-3 text-foreground/80 font-medium flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          {row.label}
                        </td>
                        <td className="p-3 text-right text-foreground font-mono font-bold">{formatCurrency(Number(row.value ?? 0))}</td>
                        <td className="p-3 text-right text-foreground/60 font-mono">{pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="p-6 text-center"><p className="text-[10px] text-foreground/30">Зарлагын өгөгдөл байхгүй.</p></div>
            )}
          </div>

          {/* Income sources */}
          <div className="border border-border/80 rounded-xl bg-card overflow-hidden">
            <div className="p-4 border-b border-border/80">
              <h2 className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Орлогын эх үүсвэр</h2>
            </div>
            {incomeChart?.data && incomeChart.data.length > 0 ? (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border/80 text-[10px] text-foreground/50 uppercase tracking-wider">
                    <th className="text-left p-3 font-semibold">Харилцагч</th>
                    <th className="text-right p-3 font-semibold">Орлого</th>
                    <th className="text-right p-3 font-semibold">Эзлэх хувь</th>
                  </tr>
                </thead>
                <tbody>
                  {incomeChart.data.map((row: any, i: number) => {
                    const total = incomeChart.data.reduce((s: number, r: any) => s + Number(r.value ?? 0), 0);
                    const pct = total > 0 ? ((Number(row.value ?? 0) / total) * 100).toFixed(1) : "0";
                    return (
                      <tr key={row.label} className="border-b border-border/40 hover:bg-foreground/5 transition-colors">
                        <td className="p-3 text-foreground/80 font-medium max-w-[140px] truncate" title={row.label}>{row.label}</td>
                        <td className="p-3 text-right text-foreground font-mono font-bold">{formatCurrency(Number(row.value ?? 0))}</td>
                        <td className="p-3 text-right text-foreground/60 font-mono">{pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="p-6 text-center"><p className="text-[10px] text-foreground/30">Орлогын өгөгдөл байхгүй.</p></div>
            )}
          </div>
        </div>

        {/* DAILY NET INCOME TREND */}
        {dailyTrend && (
          <div className="border border-border/80 rounded-xl bg-card p-5">
            <h2 className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider mb-4">Өдрийн цэвэр орлого</h2>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={dailyTrend.data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e2e8f0)" vertical={false} strokeOpacity={0.4} />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--color-foreground)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip
                  formatter={(value) => [formatCurrency(Number(value) || 0), "Цэвэр орлого"]}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid var(--color-border)", backgroundColor: "var(--color-card)" }}
                />
                <defs>
                  <linearGradient id="netIncomeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={1.5} fill="url(#netIncomeGrad)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── INCOME STATEMENT (tailan_orlog_zarlag) ── */}
        {reports?.incomeStatement && (
          <div className="border border-border/80 rounded-xl bg-card overflow-hidden">
            <div className="p-4 border-b border-border/80">
              <h2 className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Орлого, зарлагын тайлан</h2>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/80 text-[10px] text-foreground/50 uppercase tracking-wider">
                  <th className="text-left p-3 font-semibold">Үзүүлэлт</th>
                  <th className="text-right p-3 font-semibold">Дүн</th>
                </tr>
              </thead>
              <tbody>
                {reports.incomeStatement.incomeRows.length > 0 && (
                  <>
                    <tr className="border-b border-border/40 bg-foreground/5">
                      <td className="p-3 text-[10px] font-bold text-emerald-600 uppercase tracking-wider" colSpan={2}>
                        Орлого
                      </td>
                    </tr>
                    {reports.incomeStatement.incomeRows.map((row) => (
                      <tr key={row.subcategory} className="border-b border-border/30 hover:bg-foreground/5 transition-colors">
                        <td className="p-3 pl-8 text-foreground/80">{row.subcategory}</td>
                        <td className="p-3 text-right text-foreground font-mono font-bold">{formatCurrency(row.amount)}</td>
                      </tr>
                    ))}
                    <tr className="border-b border-border/40 bg-foreground/[0.03]">
                      <td className="p-3 pl-8 text-[10px] font-bold text-foreground/70 uppercase tracking-wider">Нийт орлого</td>
                      <td className="p-3 text-right font-mono font-bold" style={{ color: "#3b82f6" }}>{formatCurrency(reports.incomeStatement.totalIncome)}</td>
                    </tr>
                  </>
                )}
                {reports.incomeStatement.expenseRows.length > 0 && (
                  <>
                    <tr className="border-b border-border/40 bg-foreground/5">
                      <td className="p-3 text-[10px] font-bold text-red-500 uppercase tracking-wider" colSpan={2}>
                        Зарлага
                      </td>
                    </tr>
                    {reports.incomeStatement.expenseRows.map((row) => (
                      <tr key={row.subcategory} className="border-b border-border/30 hover:bg-foreground/5 transition-colors">
                        <td className="p-3 pl-8 text-foreground/80">{row.subcategory}</td>
                        <td className="p-3 text-right text-foreground font-mono font-bold">{formatCurrency(row.amount)}</td>
                      </tr>
                    ))}
                    <tr className="border-b border-border/40 bg-foreground/[0.03]">
                      <td className="p-3 pl-8 text-[10px] font-bold text-foreground/70 uppercase tracking-wider">Нийт зарлага</td>
                      <td className="p-3 text-right font-mono font-bold" style={{ color: "#ef4444" }}>{formatCurrency(reports.incomeStatement.totalExpense)}</td>
                    </tr>
                  </>
                )}
                <tr className="bg-foreground/[0.06]">
                  <td className="p-3 pl-8 text-[10px] font-bold text-foreground uppercase tracking-wider">Үйл ажиллагааны ашиг/алдагдал</td>
                  <td className={`p-3 text-right font-mono font-bold text-base ${reports.incomeStatement.operatingProfit >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {formatCurrency(reports.incomeStatement.operatingProfit)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── EXPENSE BREAKDOWN WITH MONTHLY PIVOT (zardaliin_zadargaa) ── */}
        {reports?.expenseBreakdown && reports.expenseBreakdown.rows.length > 0 && (
          <div className="border border-border/80 rounded-xl bg-card overflow-hidden">
            <div className="p-4 border-b border-border/80">
              <h2 className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Зардлын задаргаа</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] min-w-[500px]">
                <thead>
                  <tr className="border-b border-border/80 text-[10px] text-foreground/50 uppercase tracking-wider">
                    <th className="text-left p-3 font-semibold">Ангилал</th>
                    {reports.expenseBreakdown.months.map((m) => (
                      <th key={m} className="text-right p-3 font-semibold">{m}</th>
                    ))}
                    <th className="text-right p-3 font-semibold">Нийт</th>
                    <th className="text-right p-3 font-semibold">%</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.expenseBreakdown.rows.map((row, i) => (
                    <tr key={row.category} className="border-b border-border/40 hover:bg-foreground/5 transition-colors">
                      <td className="p-3 text-foreground/80 font-medium flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        {row.category}
                      </td>
                      {row.monthly.map((val, mi) => (
                        <td key={mi} className="p-3 text-right text-foreground font-mono">{formatCurrency(val)}</td>
                      ))}
                      <td className="p-3 text-right text-foreground font-mono font-bold">{formatCurrency(row.total)}</td>
                      <td className="p-3 text-right text-foreground/60 font-mono">{row.pct}%</td>
                    </tr>
                  ))}
                  <tr className="bg-foreground/[0.04] border-t-2 border-border/60">
                    <td className="p-3 text-[10px] font-bold text-foreground/70 uppercase tracking-wider">Нийт</td>
                    {reports.expenseBreakdown.months.map((_m, mi) => {
                      const monthTotal = reports.expenseBreakdown!.rows.reduce((s, r) => s + (r.monthly[mi] || 0), 0);
                      return <td key={mi} className="p-3 text-right text-foreground font-mono font-bold">{formatCurrency(monthTotal)}</td>;
                    })}
                    <td className="p-3 text-right text-foreground font-mono font-bold">{formatCurrency(reports.expenseBreakdown.grandTotal)}</td>
                    <td className="p-3 text-right text-foreground/60 font-mono">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── CASH FLOW STATEMENT (mungun_ursgal) ── */}
        {reports?.cashFlow && reports.cashFlow.sections.length > 0 && (
          <div className="border border-border/80 rounded-xl bg-card overflow-hidden">
            <div className="p-4 border-b border-border/80">
              <h2 className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Мөнгөн урсгалын тайлан</h2>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/80 text-[10px] text-foreground/50 uppercase tracking-wider">
                  <th className="text-left p-3 font-semibold">Үзүүлэлт</th>
                  <th className="text-right p-3 font-semibold">Дүн</th>
                </tr>
              </thead>
              <tbody>
                {reports.cashFlow.sections.map((section) => (
                  <React.Fragment key={section.name}>
                    <tr className="border-b border-border/40 bg-foreground/5">
                      <td className="p-3 text-[10px] font-bold text-foreground/60 uppercase tracking-wider" colSpan={2}>
                        {section.name}
                      </td>
                    </tr>
                    {section.items.map((item) => (
                      <tr key={item.name} className="border-b border-border/30 hover:bg-foreground/5 transition-colors">
                        <td className="p-3 pl-8 text-foreground/80">{item.name}</td>
                        <td className={`p-3 text-right font-mono font-bold ${section.subtotal < 0 ? "text-red-500" : "text-emerald-500"}`}>
                          {section.subtotal < 0 ? `-${formatCurrency(Math.abs(item.amount))}` : formatCurrency(item.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b border-border/40 bg-foreground/[0.03]">
                      <td className="p-3 pl-8 text-[10px] font-bold text-foreground/70 uppercase tracking-wider">
                        {section.subtotal < 0 ? "Нийт зарлага" : "Нийт орлого"}
                      </td>
                      <td className={`p-3 text-right font-mono font-bold ${section.subtotal < 0 ? "text-red-500" : "text-emerald-500"}`}>
                        {section.subtotal < 0 ? `-${formatCurrency(Math.abs(section.subtotal))}` : formatCurrency(section.subtotal)}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
                <tr className="bg-foreground/[0.06]">
                  <td className="p-3 pl-8 text-[10px] font-bold text-foreground uppercase tracking-wider">Цэвэр мөнгөн урсгал</td>
                  <td className={`p-3 text-right font-mono font-bold text-base ${reports.cashFlow.netCashFlow >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {formatCurrency(reports.cashFlow.netCashFlow)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* FOOTER */}
        <div className="text-center text-[9px] text-foreground/30 py-4 border-t border-border/40">
          Шинжээч.ai · Автомат санхүүгийн тайлан · {new Date().toISOString().split("T")[0]}
        </div>
      </div>
    </div>
  );
};
