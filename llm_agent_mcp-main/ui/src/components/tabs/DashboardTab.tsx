"use client";

import React from "react";
import { LayoutDashboard } from "lucide-react";
import { KpiGrid } from "../KpiGrid";
import { AdminPanel } from "../AdminPanel";
import { Footer } from "../Footer";
import { AnomalyBadge } from "../AnomalyBadge";
import { WhatIfPanel } from "../WhatIfPanel";
import { AlertBell } from "../AlertBell";
import { ExportButton } from "../ExportButton";
import AvatarList from "../AvatarList";
import { SalesCard, TopSearch, ProportionSales, ActiveChart, IntroduceRow, OfflineData, Gauge, Radar, PageLoading, Liquid, EditableLinkGroup, PageHeaderContent, ExtraContent } from "../dashboard";
import { FinanceDashboard } from "../FinanceDashboard";
import type { Period } from "../../hooks/useDashboard";
import type { AuthUser } from "../../hooks/useAuth";
import type { KpiData, ComputedMetrics, SalesHistory, UploadedFile } from "../types";
import type { FinanceAudit } from "../../hooks/useDashboard";

interface DashboardTabProps {
  user: AuthUser;
  token: string;
  hasDataset: boolean;
  isDashboardLoading: boolean;
  dashboard: {
    period: Period;
    setPeriod: (p: Period) => void;
    salesKpi: KpiData | null;
    usersKpi: KpiData | null;
    churnKpi: KpiData | null;
    computedMetrics: ComputedMetrics | null;
    salesHistory: SalesHistory[];
    financeAudit: FinanceAudit | null;
    financeCharts: Record<string, unknown> | null;
    fetchDashboardData: () => void;
  };
  financeData: {
    financeSummary: Record<string, unknown> | null;
    financePeriod: string | undefined;
    financeMonthlyIncome: Array<{ x: string; y: number }> | undefined;
    financeMonthlyExpense: Array<{ x: string; y: number }> | undefined;
    financeExpensePieData: Array<{ x: string; y: number }> | undefined;
    financeExpenseCategories: Array<{ name: string; share: number; color: string }> | null;
    financeCounterparties: Array<{ index: number; name: string; amount: number; share: number }> | null;
    financeCashData: Array<{ x: string; y: number }> | null;
    financeRadarData: Array<{ subject: string; A: number; fullMark: number }> | null;
  };
  admin: {
    adjustMetric: "sales" | "users" | "churn_rate";
    newTargetValue: number;
    isUpdatingTarget: boolean;
    salesUpdateSuccess: string | null;
    csvFile: File | null;
    tableNameInput: string;
    tableDescInput: string;
    isUploadingCsv: boolean;
    csvUploadMessage: string | null;
    excelFile: File | null;
    excelTableNameInput: string;
    excelDescInput: string;
    isUploadingExcel: boolean;
    excelUploadMessage: string | null;
    docFile: File | null;
    docDescInput: string;
    isUploadingDoc: boolean;
    docUploadMessage: string | null;
    uploadedFiles: UploadedFile[];
    setAdjustMetric: (v: "sales" | "users" | "churn_rate") => void;
    setNewTargetValue: (v: number) => void;
    handleUpdateKpiTarget: () => void;
    setCsvFile: (v: File | null) => void;
    setTableNameInput: (v: string) => void;
    setTableDescInput: (v: string) => void;
    handleUploadCsv: (e: React.FormEvent) => void;
    setExcelFile: (v: File | null) => void;
    setExcelTableNameInput: (v: string) => void;
    setExcelDescInput: (v: string) => void;
    handleUploadExcel: (e: React.FormEvent) => void;
    setDocFile: (v: File | null) => void;
    setDocDescInput: (v: string) => void;
    handleUploadDoc: (e: React.FormEvent) => void;
    fetchUploadedFiles: () => void;
    handleDeleteFile: (id: string) => void;
  };
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  preview: {
    open: (file: UploadedFile) => void;
  };
}

const DashboardTabInner: React.FC<DashboardTabProps> = ({
  user,
  token,
  hasDataset,
  isDashboardLoading,
  dashboard,
  financeData,
  admin,
  sidebarOpen,
  setSidebarOpen,
  preview,
}) => {
  const fs = (financeData.financeSummary ?? {}) as Record<string, number>;
  return (
    <main key="tab-dashboard" className="flex-1 flex overflow-hidden min-h-0 relative animate-fade-in-up">
      {sidebarOpen && <div className="md:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <section className={`shrink-0 border-r border-border bg-sidebar p-4 flex-col overflow-y-auto scrollbar-hide space-y-4 transition-all duration-200 md:w-[280px] md:flex md:relative ${sidebarOpen ? "fixed inset-y-0 left-0 z-50 w-[280px] shadow-xl flex" : "hidden"} md:inset-auto md:z-auto md:shadow-none`}>
        <div className="flex items-center justify-between md:hidden">
          <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider">Удирдлага</span>
          <button onClick={() => setSidebarOpen(false)} className="text-foreground/50 hover:text-foreground text-xs p-1 cursor-pointer">✕</button>
        </div>
        <div className="space-y-2">
          <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">Багийн гишүүд</span>
          <AvatarList maxLength={4}>
            <AvatarList.Item name="Admin" tips="Админ" onClick={() => {}} />
            <AvatarList.Item name="User" tips="Хэрэглэгч" />
            <AvatarList.Item name="Analyst" />
            <AvatarList.Item name="Viewer" />
            <AvatarList.Item name="Guest" />
          </AvatarList>
        </div>
        <div className="space-y-2">
          <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">Хурдан холбоос</span>
          <EditableLinkGroup links={[
            { title: "Борлуулалт", href: "#" }, { title: "Тайлан", href: "#" },
            { title: "Хэрэглэгчид", href: "#" }, { title: "Бүтээгдэхүүн", href: "#" },
            { title: "Аналитик", href: "#" }, { title: "Тохиргоо", href: "#" },
          ]} />
        </div>
        <AdminPanel
          user={user}
          adjustMetric={admin.adjustMetric} newTargetValue={admin.newTargetValue}
          isUpdatingTarget={admin.isUpdatingTarget} salesUpdateSuccess={admin.salesUpdateSuccess}
          onAdjustMetricChange={admin.setAdjustMetric} onNewTargetValueChange={admin.setNewTargetValue}
          onUpdateKpiTarget={admin.handleUpdateKpiTarget}
          csvFile={admin.csvFile} tableNameInput={admin.tableNameInput} tableDescInput={admin.tableDescInput}
          isUploadingCsv={admin.isUploadingCsv} csvUploadMessage={admin.csvUploadMessage}
          onCsvFileChange={admin.setCsvFile} onTableNameInputChange={admin.setTableNameInput}
          onTableDescInputChange={admin.setTableDescInput} onUploadCsv={admin.handleUploadCsv}
          excelFile={admin.excelFile} excelTableNameInput={admin.excelTableNameInput}
          excelDescInput={admin.excelDescInput} isUploadingExcel={admin.isUploadingExcel}
          excelUploadMessage={admin.excelUploadMessage} onExcelFileChange={admin.setExcelFile}
          onExcelTableNameInputChange={admin.setExcelTableNameInput}
          onExcelDescInputChange={admin.setExcelDescInput} onUploadExcel={admin.handleUploadExcel}
          docFile={admin.docFile} docDescInput={admin.docDescInput}
          isUploadingDoc={admin.isUploadingDoc} docUploadMessage={admin.docUploadMessage}
          onDocFileChange={admin.setDocFile} onDocDescInputChange={admin.setDocDescInput}
          onUploadDoc={admin.handleUploadDoc}
          uploadedFiles={admin.uploadedFiles} onViewFile={preview.open}
          onDeleteFile={admin.handleDeleteFile}
        />
      </section>

      {/* Dashboard content */}
      <section className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-background p-4 md:p-6">
        {!hasDataset ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <LayoutDashboard className="w-12 h-12 text-foreground/20" />
            <div>
              <p className="text-sm font-semibold text-foreground/60">Dashboard хоосон байна</p>
              <p className="text-[10px] text-foreground/40 mt-1">Dashboard харахын тулд эхлээд зүүн талын самбараар дата оруулна уу.</p>
            </div>
          </div>
        ) : isDashboardLoading ? (
          <PageLoading />
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2 md:hidden">
              <button onClick={() => setSidebarOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-border rounded bg-sidebar text-foreground/60 hover:text-foreground transition-colors cursor-pointer">
                Удирдлага
              </button>
            </div>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-fade-in-up">
              <PageHeaderContent currentUser={{
                avatar: user?.email?.charAt(0).toUpperCase(),
                name: user?.email?.split("@")[0] || "Хэрэглэгч",
                title: "Өгөгдлийн шинжээч", group: "Аналитик хэлтэс",
              }} />
              <ExtraContent />
            </div>

            {/* Period selector + Anomaly Badge */}
            <div className="flex items-center gap-3 animate-fade-in-up flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Хугацаа:</span>
                <div className="flex items-center border border-border rounded overflow-hidden text-[10px] font-bold">
                  {(["7d", "1m", "3m", "6m", "12m", "all"] as Period[]).map((p) => (
                    <button key={p} onClick={() => dashboard.setPeriod(p)}
                      className={`px-2 py-1 uppercase tracking-wider transition-colors cursor-pointer ${dashboard.period === p ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground"}`}>
                      {p === "all" ? "Бүгд" : p}
                    </button>
                  ))}
                </div>
              </div>
              {hasDataset && <AnomalyBadge token={token} />}
              {hasDataset && <WhatIfPanel token={token} />}
              {hasDataset && <AlertBell token={token} />}
              {hasDataset && <ExportButton token={token} />}
            </div>

            <div className="animate-fade-in-up" style={{ animationDelay: "50ms" }}>
              <KpiGrid salesKpi={dashboard.salesKpi} usersKpi={dashboard.usersKpi} churnKpi={dashboard.churnKpi} computedMetrics={dashboard.computedMetrics} salesHistory={dashboard.salesHistory} isLoading={isDashboardLoading} />
            </div>

            {dashboard.financeAudit?.available && (
              <div className="animate-fade-in-up border border-border/60 rounded-xl p-4 bg-card shadow-sm text-[11px]" style={{ animationDelay: "60ms" }}>
                <p className="font-bold text-foreground/50 uppercase tracking-wider mb-2.5">Дата тоймлол — {dashboard.financeAudit.tableName}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-green-500">✓</span>
                    <span className="text-foreground/60">Орлогын мөр:</span>
                    <span className="font-semibold text-foreground">{dashboard.financeAudit.incomeRows}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-blue-500">✓</span>
                    <span className="text-foreground/60">Зарлагын мөр:</span>
                    <span className="font-semibold text-foreground">{dashboard.financeAudit.expenseRows}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-yellow-500">⚠</span>
                    <span className="text-foreground/60">Шүүгдсэн (noise):</span>
                    <span className="font-semibold text-foreground">{dashboard.financeAudit.noiseRows}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={(dashboard.financeAudit.unclassifiedRows ?? 0) > 0 ? "text-red-500" : "text-foreground/40"}>
                      {(dashboard.financeAudit.unclassifiedRows ?? 0) > 0 ? "⚠" : "✓"}
                    </span>
                    <span className="text-foreground/60">Ангилагдаагүй:</span>
                    <span className={`font-semibold ${(dashboard.financeAudit.unclassifiedRows ?? 0) > 0 ? "text-red-500" : "text-foreground"}`}>
                      {dashboard.financeAudit.unclassifiedRows}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="animate-fade-in-up" style={{ animationDelay: "80ms" }}>
              <FinanceDashboard />
            </div>

            <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
              <IntroduceRow
                totalSales={fs.totalIncome ?? dashboard.salesKpi?.current}
                totalVisits={financeData.financeCounterparties?.length ?? dashboard.usersKpi?.current}
                transactionCount={fs.totalTransactions}
                operatingProfit={fs.operatingProfit}
                visitData={financeData.financeMonthlyIncome ?? undefined}
                campaignEffect={fs.totalIncome
                  ? Math.min(100, Math.max(0, Math.round((fs.operatingProfit / fs.totalIncome) * 100)))
                  : undefined}
              />
            </div>

            <div className="animate-fade-in-up" style={{ animationDelay: "150ms" }}>
              <SalesCard
                salesData={financeData.financeMonthlyIncome ?? (dashboard.salesHistory.length > 0 ? dashboard.salesHistory.map(h => ({ x: h.month, y: h.revenue })) : undefined)}
                expenseData={financeData.financeMonthlyExpense ?? undefined}
                rankingData={financeData.financeExpenseCategories?.map(c => ({ title: c.name, total: Math.round(c.share * (fs.totalExpense ?? 0)) })) ?? undefined}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-in-up" style={{ animationDelay: "200ms" }}>
              <ProportionSales salesPieData={financeData.financeExpensePieData ?? undefined} />
              <TopSearch counterparties={financeData.financeCounterparties ?? undefined} period={financeData.financePeriod} />
            </div>

            <div className="border border-border/60 rounded-xl p-5 bg-card shadow-sm animate-fade-in-up" style={{ animationDelay: "250ms" }}>
              <div className="flex items-center gap-2 mb-4">
                <span className="block w-0.5 h-4 rounded-full bg-blue-500" />
                <p className="text-[11px] font-bold text-foreground/60 uppercase tracking-wider">Мөнгөний үлдэгдлийн хөдөлгөөн — {financeData.financePeriod ?? `Q1 ${new Date().getFullYear()}`}</p>
              </div>
              <ActiveChart cashData={financeData.financeCashData ?? undefined} />
            </div>

            <div className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <OfflineData
                  categories={financeData.financeExpenseCategories ?? undefined}
                  monthlyExpenses={(() => {
                    const charts = (dashboard.financeCharts?.charts as Array<Record<string, unknown>>) ?? [];
                    const esc = charts.find((c) => c.id === "monthly_expense_subcat");
                    if (!esc?.data) return undefined;
                    const result: Record<string, { month: string; amount: number }[]> = {};
                    const subcats = Object.keys((esc.data as Array<Record<string, unknown>>)[0] || {}).filter((k) => k !== "label");
                    for (const sub of subcats) {
                      result[sub] = (esc.data as Array<Record<string, unknown>>).map((d) => ({ month: String(d.label ?? ""), amount: Number(d[sub] ?? 0) }));
                    }
                    return result;
                  })()}
                />
                <div className="grid grid-cols-2 gap-4">
                  <div className="border border-border/60 rounded-xl p-5 bg-card shadow-sm flex flex-col items-center justify-center">
                    <Gauge
                      percent={financeData.financeSummary
                        ? Math.min(100, Math.round((fs.totalIncome / (dashboard.salesKpi?.target ?? 200_000_000)) * 100))
                        : dashboard.salesKpi ? Math.min(100, Math.round((dashboard.salesKpi.current / dashboard.salesKpi.target) * 100)) : 89}
                      title="Орлогын гүйцэтгэл" size={180}
                    />
                  </div>
                  <div className="border border-border/60 rounded-xl p-5 bg-card shadow-sm flex flex-col items-center justify-center gap-3">
                    <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider">Дүүргэлт</span>
                    <Liquid
                      percent={financeData.financeSummary
                        ? Math.min(1, fs.totalIncome / (dashboard.salesKpi?.target ?? 200_000_000))
                        : dashboard.salesKpi ? Math.min(1, dashboard.salesKpi.current / (dashboard.salesKpi.target * 1.15)) : 0.50}
                      height={130}
                    />
                  </div>
                </div>
              </div>
              <div className="border border-border/60 rounded-xl p-5 bg-card shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <span className="block w-0.5 h-4 rounded-full bg-purple-500" />
                  <p className="text-[11px] font-bold text-foreground/60 uppercase tracking-wider">Үзүүлэлтийн харьцуулалт</p>
                </div>
                <Radar data={financeData.financeRadarData?.map(r => ({ label: r.subject, value: r.A })) ?? undefined} height={280} />
              </div>
            </div>

            <Footer />
          </div>
        )}
      </section>
    </main>
  );
};

export const DashboardTab = React.memo(DashboardTabInner);
