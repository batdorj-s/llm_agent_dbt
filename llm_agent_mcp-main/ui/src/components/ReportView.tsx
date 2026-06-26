"use client";

import React, { useEffect, useState } from "react";
import { FileText, Download, FileSpreadsheet, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { KpiData, SalesHistory, ComputedMetrics } from "./types";
import { chartTheme } from "./chartTheme";

interface ReportData {
  salesKpi: KpiData | null;
  usersKpi: KpiData | null;
  churnKpi: KpiData | null;
  computedMetrics: ComputedMetrics | null;
  salesHistory: SalesHistory[];
}

function SkeletonLine({ width }: { width: string }) {
  return <div className="h-3 bg-foreground/10 rounded animate-pulse" style={{ width }} />;
}

function ReportSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <SkeletonLine width="160px" />
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

function TrendBadge({ rate, direction }: { rate: number; direction: "up" | "down" }) {
  if (rate === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-foreground/50 font-mono">
        <Minus className="w-3 h-3" /> 0%
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold ${
      direction === "up" ? "text-emerald-500" : "text-red-500"
    }`}>
      {direction === "up" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(rate).toFixed(1)}%
    </span>
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
      a.download = `report-${new Date().toISOString().split("T")[0]}.${label.toLowerCase()}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export amjiltgüi bolloo.");
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

type ReportTemplate = "summary" | "detailed";

export const ReportView = ({ token }: { token: string }) => {
  const [data, setData] = useState<ReportData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<ReportTemplate>("detailed");

  useEffect(() => {
    if (!token) { setIsLoading(false); return; }
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch("/api/kpi/sales", { headers }),
      fetch("/api/kpi/users", { headers }),
      fetch("/api/kpi/churn_rate", { headers }),
      fetch("/api/kpi-history?limit=12", { headers }),
      fetch("/api/dashboard/computed-metrics", { headers }),
    ]).then(async ([salesRes, usersRes, churnRes, historyRes, computedRes]) => {
      if (cancelled) return;
      const [salesKpi, usersKpi, churnKpi, salesHistory, computedMetrics] = await Promise.all([
        salesRes.ok ? salesRes.json() : null,
        usersRes.ok ? usersRes.json() : null,
        churnRes.ok ? churnRes.json() : null,
        historyRes.ok ? historyRes.json() : [],
        computedRes.ok ? computedRes.json() : null,
      ]);
      if (!cancelled) {
        setData({ salesKpi, usersKpi, churnKpi, salesHistory, computedMetrics });
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
  if (!data) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs text-foreground/50">Тайланд харуулах өгөгдөл байхгүй.</p>
    </div>
  );

  const { salesKpi, usersKpi, churnKpi, computedMetrics, salesHistory } = data;
  const aov = computedMetrics?.aov ?? null;
  const growthRate = computedMetrics?.growthRate ?? null;
  const growthDirection = computedMetrics?.growthDirection ?? "up";
  const topCategory = computedMetrics?.topCategory ?? null;

  const churnColor = churnKpi && churnKpi.current > churnKpi.target ? "#ef4444" : "#10b981";

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* HEADER */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-sm font-bold text-foreground flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Борлуулалтын тайлан
            </h1>
            <p className="text-[10px] text-foreground/50 mt-1">
              Үүсгэсэн: {new Date().toLocaleDateString("mn-MN", { year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center border border-border rounded overflow-hidden text-[10px] font-bold">
              <button onClick={() => setTemplate("summary")}
                className={`px-2.5 py-1.5 uppercase tracking-wider transition-colors cursor-pointer ${template === "summary" ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground"}`}>
                Товч
              </button>
              <button onClick={() => setTemplate("detailed")}
                className={`px-2.5 py-1.5 uppercase tracking-wider transition-colors cursor-pointer ${template === "detailed" ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground"}`}>
                Дэлгэрэнгүй
              </button>
            </div>
            <ExportButton token={token} label="PDF" endpoint="/api/report/export-pdf" icon={<Download className="w-3 h-3" />} />
            <ExportButton token={token} label="Excel" endpoint="/api/report/export-xlsx" icon={<FileSpreadsheet className="w-3 h-3" />} />
          </div>
        </div>

        {/* KPI SUMMARY */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border border-border/80 rounded-xl p-4 bg-card">
            <p className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Борлуулалт</p>
            <p className="text-lg font-extrabold text-foreground mt-1" style={{ color: chartTheme.colors.semantic.bar }}>
              {salesKpi ? formatCurrency(salesKpi.current) : "—"}
            </p>
            <p className="text-[10px] text-foreground/50 mt-1">Зорилтот: {salesKpi ? formatCurrency(salesKpi.target) : "—"}</p>
          </div>
          <div className="border border-border/80 rounded-xl p-4 bg-card">
            <p className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Хэрэглэгчид</p>
            <p className="text-lg font-extrabold text-foreground mt-1" style={{ color: chartTheme.colors.semantic.line }}>
              {usersKpi ? usersKpi.current.toLocaleString() : "—"}
            </p>
            <p className="text-[10px] text-foreground/50 mt-1">Зорилтот: {usersKpi ? usersKpi.target.toLocaleString() : "—"}</p>
          </div>
          <div className="border border-border/80 rounded-xl p-4 bg-card">
            <p className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Churn Rate</p>
            <p className="text-lg font-extrabold text-foreground mt-1" style={{ color: churnColor }}>
              {churnKpi ? `${churnKpi.current}%` : "—"}
            </p>
            <p className="text-[10px] text-foreground/50 mt-1">Хязгаар: {churnKpi ? `${churnKpi.target}%` : "—"}</p>
          </div>
          <div className="border border-border/80 rounded-xl p-4 bg-card">
            <p className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Дундаж захиалга</p>
            <p className="text-lg font-extrabold text-foreground mt-1" style={{ color: chartTheme.colors.semantic.area }}>
              {aov !== null ? formatCurrency(aov) : "—"}
            </p>
            <p className="text-[10px] text-foreground/50 mt-1">
              {growthRate !== null ? <TrendBadge rate={growthRate} direction={growthDirection} /> : "—"}
            </p>
          </div>
        </div>

        {/* DETAIL SECTIONS */}
        {(template === "detailed") && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* TOP CATEGORY */}
          <div className="border border-border/80 rounded-xl p-4 bg-card">
            <h2 className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider mb-3">Шилдэг категори</h2>
            {topCategory && aov !== null ? (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-foreground/5 flex items-center justify-center">
                  <span className="text-lg font-bold text-foreground/80">{topCategory.charAt(0)}</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{topCategory}</p>
                  <p className="text-[10px] text-foreground/50">
                    {computedMetrics ? formatCurrency(computedMetrics.topCategoryValue) : "—"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-foreground/30">Категорийн өгөгдөл байхгүй.</p>
            )}
          </div>

          {/* GROWTH RATE */}
          <div className="border border-border/80 rounded-xl p-4 bg-card">
            <h2 className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider mb-3">Өсөлтийн харьцуулалт</h2>
            {growthRate !== null ? (
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  growthDirection === "up" ? "bg-emerald-500/10" : "bg-red-500/10"
                }`}>
                  {growthDirection === "up"
                    ? <TrendingUp className={`w-5 h-5 ${growthDirection === "up" ? "text-emerald-500" : "text-red-500"}`} />
                    : <TrendingDown className="w-5 h-5 text-red-500" />
                  }
                </div>
                <div>
                  <p className={`text-sm font-bold ${growthDirection === "up" ? "text-emerald-500" : "text-red-500"}`}>
                    {growthDirection === "up" ? "+" : ""}{growthRate.toFixed(1)}%
                  </p>
                  <p className="text-[10px] text-foreground/50">Сүүлийн 30 хоног / Өмнөх 30 хоног</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-foreground/30">Өсөлтийн өгөгдөл байхгүй.</p>
            )}
          </div>
        </div>}

        {template === "detailed" && (
        <div className="border border-border/80 rounded-xl bg-card overflow-hidden">
          <div className="p-4 border-b border-border/80">
            <h2 className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Борлуулалтын түүх</h2>
          </div>
          {salesHistory.length > 0 ? (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/80 text-[10px] text-foreground/50 uppercase tracking-wider">
                  <th className="text-left p-3 font-semibold">Сар</th>
                  <th className="text-right p-3 font-semibold">Орлого</th>
                  <th className="text-right p-3 font-semibold">Өөрчлөлт</th>
                </tr>
              </thead>
              <tbody>
                {salesHistory.map((row, i) => {
                  const prev = i > 0 ? salesHistory[i - 1].revenue : row.revenue;
                  const change = prev > 0 ? ((row.revenue - prev) / prev * 100) : 0;
                  return (
                    <tr key={row.month} className="border-b border-border/40 hover:bg-foreground/5 transition-colors">
                      <td className="p-3 text-foreground/80 font-medium">{row.month}</td>
                      <td className="p-3 text-right text-foreground font-mono font-bold">
                        {formatCurrency(row.revenue)}
                      </td>
                      <td className="p-3 text-right">
                        {i > 0 ? (
                          <span className={`text-[10px] font-mono font-bold ${
                            change >= 0 ? "text-emerald-500" : "text-red-500"
                          }`}>
                            {change >= 0 ? "+" : ""}{change.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-[10px] text-foreground/30">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-6 text-center">
              <p className="text-[10px] text-foreground/30">Борлуулалтын түүх байхгүй.</p>
            </div>
          )}
        </div>
        )}

        {/* FOOTER */}
        <div className="text-center text-[9px] text-foreground/30 py-4 border-t border-border/40">
          Шинжээч.ai · Автомат тайлан · {new Date().toISOString().split("T")[0]}
        </div>
      </div>
    </div>
  );
};
