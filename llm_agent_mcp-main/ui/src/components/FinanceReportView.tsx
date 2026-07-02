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

function ExportButton({ token, label, endpoint, icon }: { token: string; label: string; endpoint: string; icon: React.ReactNode }) {
  const [isExporting, setIsExporting] = useState(false);
  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
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
      alert("Export amjiltgui bolloo.");
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

export const FinanceReportView = ({ token }: { token: string }) => {
  const [data, setData] = useState<FinanceChartsResponse | null>(null);
  const [metrics, setMetrics] = useState<ComputedMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setIsLoading(false); return; }
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch("/api/finance-charts", { headers }),
      fetch("/api/dashboard/computed-metrics", { headers }),
    ]).then(async ([chartsRes, metricsRes]) => {
      if (cancelled) return;
      const [chartsData, metricsData] = await Promise.all([
        chartsRes.ok ? chartsRes.json() : null,
        metricsRes.ok ? metricsRes.json() : null,
      ]);
      if (!cancelled) {
        setData(chartsData);
        setMetrics(metricsData);
        setIsLoading(false);
      }
    }).catch(() => {
      if (!cancelled) { setError("Тайлангийн өгөгдөл ачаалахад алдаа гарлаа."); setIsLoading(false); }
    });

    return () => { cancelled = true; };
  }, [token]);

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
            <ExportButton token={token} label="PDF" endpoint="/api/report/export-pdf" icon={<Download className="w-3 h-3" />} />
            <ExportButton token={token} label="Excel" endpoint="/api/report/export-xlsx" icon={<FileSpreadsheet className="w-3 h-3" />} />
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

        {/* FOOTER */}
        <div className="text-center text-[9px] text-foreground/30 py-4 border-t border-border/40">
          Шинжээч.ai · Автомат санхүүгийн тайлан · {new Date().toISOString().split("T")[0]}
        </div>
      </div>
    </div>
  );
};
