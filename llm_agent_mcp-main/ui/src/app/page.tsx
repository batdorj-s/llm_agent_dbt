"use client";

import React, { useState, useEffect, useRef } from "react";
import { BarChart2, Activity, TrendingUp, TrendingDown, PieChart as PieChartIcon, ArrowUp, LayoutDashboard, ThumbsUp, ThumbsDown } from "lucide-react";

import { Header } from "../components/Header";
import { LoginForm } from "../components/LoginForm";
import { KpiGrid } from "../components/KpiGrid";
import { ReportView } from "../components/ReportView";
import { AdminPanel } from "../components/AdminPanel";
import { ChatInput } from "../components/ChatInput";
import { PreviewDrawer } from "../components/PreviewDrawer";
import { formatMessageText } from "../components/ChatMessage";
import { OfflineBanner } from "../components/OfflineBanner";
import { Footer } from "../components/Footer";
import AvatarList from "../components/AvatarList";
import { SalesCard, TopSearch, ProportionSales, ActiveChart, IntroduceRow, OfflineData, Gauge, Radar, PageLoading, Liquid, EditableLinkGroup, PageHeaderContent, ExtraContent } from "../components/dashboard";
import { FinanceDashboard } from "../components/FinanceDashboard";
import { FinanceReportView } from "../components/FinanceReportView";

import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { useChat } from "../hooks/useChat";
import { useDashboard, type Period } from "../hooks/useDashboard";
import { useAdmin } from "../hooks/useAdmin";
import { usePreview } from "../hooks/usePreview";

// ─── Suggestion constants ─────────────────────────────────────────────────────

const SUGGESTIONS_INITIAL = [
  { label: "Нийт зарлага",     query: "Нийт зарлага хэд вэ?",                     icon: <TrendingDown className="w-3 h-3" /> },
  { label: "Нийт орлого",      query: "Нийт орлого хэд вэ?",                      icon: <TrendingUp   className="w-3 h-3" /> },
  { label: "Зардлын задаргаа", query: "Зардлын задаргааг ангилалаар харуул",       icon: <PieChartIcon className="w-3 h-3" /> },
  { label: "Сараар харьцуулалт", query: "Сараар орлого зарлагын харьцуулалт харуул", icon: <BarChart2     className="w-3 h-3" /> },
  { label: "Хамгийн их зардал", query: "Хамгийн их зардалтай ангилал юу вэ?",     icon: <ArrowUp      className="w-3 h-3" /> },
  { label: "Тайлан",           query: "Санхүүгийн тайлан гаргаж өгнө үү",         icon: <Activity     className="w-3 h-3" /> },
];

const FOLLOW_UP_SUGGESTIONS: Record<string, { label: string; query: string }[]> = {
  "Finance Agent": [
    { label: "Дэлгэрэнгүй мэдээлэл", query: "Өмнөх хариултаа дэлгэрэнгүй тайлбарла" },
    { label: "Өмнөх сартай харьцуулах", query: "Өмнөх сарын үзүүлэлттэй харьцуул" },
    { label: "Графикаар харуул", query: "Энэ өгөгдлийг графикаар харуул" },
  ],
  "Tech Agent": [
    { label: "Top 5 харуул",  query: "Хамгийн их борлуулалттай эхний 5-ыг харуул" },
    { label: "График зур",    query: "Өгөгдлийн график зурж харуул" },
    { label: "Dashboard",     query: "Энэ өгөгдлийг dashboard болгож харуул" },
  ],
  "DataScientistAgent": [
    { label: "Forecast шинэчлэх",  query: "Шинэ өгөгдлөөр таамаглалаа шинэчил" },
    { label: "Cluster дэлгэрэнгүй", query: "Бүлэглэлтийн дэлгэрэнгүй шинжилгээ харуул" },
    { label: "Корреляцийн матриц", query: "Корреляцийн матриц харуул" },
  ],
};

// ─── Finance data helpers ─────────────────────────────────────────────────────

function useFinanceChartData(financeCharts: any, salesKpi: any) {
  const financeSummary        = financeCharts?.summary ?? null;
  const financePeriod         = financeCharts?.period;
  const findChart             = (id: string) => financeCharts?.charts?.find((c: any) => c.id === id);

  const financeMonthlyIncome = (() => {
    const cf = findChart("monthly_cashflow");
    return cf?.data?.map((d: any) => ({ x: d.label, y: Number(d["Орлого"] ?? 0) })) ?? null;
  })();

  const financeMonthlyExpense = (() => {
    const cf = findChart("monthly_cashflow");
    return cf?.data?.map((d: any) => ({ x: d.label, y: Number(d["Зарлага"] ?? 0) })) ?? null;
  })();

  const financeExpenseCategories: { name: string; share: number; color: string }[] | null = (() => {
    const cb = findChart("category_breakdown");
    if (!cb?.data) return null;
    const total = cb.data.reduce((s: number, d: any) => s + Number(d.value ?? 0), 0);
    return cb.data.map((d: any, i: number) => ({
      name: String(d.label ?? ""), share: total > 0 ? Number(d.value ?? 0) / total : 0,
      color: ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6"][i % 7],
    }));
  })();

  const financeExpensePieData = (() => {
    const cb = findChart("category_breakdown");
    return cb?.data?.map((d: any) => ({ x: String(d.label ?? ""), y: Number(d.value ?? 0) })) ?? null;
  })();

  const financeCounterparties = (() => {
    const tp = findChart("top_parties");
    if (!tp?.data) return null;
    const total = tp.data.reduce((s: number, d: any) => s + Number(d.value ?? 0), 0);
    return tp.data.map((d: any, i: number) => ({
      index: i + 1, name: String(d.label ?? ""), amount: Number(d.value ?? 0),
      share: total > 0 ? Math.round((Number(d.value ?? 0) / total) * 1000) / 10 : 0,
    }));
  })();

  const financeCashData = (() => {
    const dt = findChart("daily_trend");
    if (!dt?.data) return null;
    let cumulative = 0;
    return dt.data.map((d: any) => { cumulative += Number(d.value ?? 0); return { x: String(d.label ?? ""), y: cumulative }; });
  })();

  const financeRadarData = (() => {
    if (!financeSummary) return null;
    const incomeScore  = financeSummary.totalIncome > 0 ? Math.min(100, Math.round((financeSummary.totalIncome / (salesKpi?.target ?? 200_000_000)) * 100)) : 50;
    const expenseRatio = financeSummary.totalIncome > 0 ? Math.round((1 - financeSummary.totalExpense / financeSummary.totalIncome) * 100) : 50;
    const profitScore  = financeSummary.totalIncome > 0 ? Math.min(100, Math.round((financeSummary.operatingProfit / financeSummary.totalIncome) * 100 * 5)) : 50;
    return [
      { label: "Нийт орлого",               value: Math.min(100, incomeScore) },
      { label: "Зарлагын хяналт",            value: Math.min(100, expenseRatio) },
      { label: "ҮА ашиг",                    value: Math.min(100, profitScore) },
      { label: "Гүйлгээний тоо",             value: 85 },
      { label: "Мөнгөн урсгал",              value: financeSummary.operatingProfit > 0 ? 70 : 40 },
      { label: "Санхүүгийн тогтвортой байдал", value: Math.min(100, Math.round((incomeScore + expenseRatio + profitScore) / 3)) },
    ];
  })();

  return { financeSummary, financePeriod, financeMonthlyIncome, financeMonthlyExpense, financeExpenseCategories, financeExpensePieData, financeCounterparties, financeCashData, financeRadarData };
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

export default function Home() {
  const [activeTab, setActiveTab]             = useState<"ask" | "dashboard" | "report">("ask");
  const [sidebarOpen, setSidebarOpen]         = useState(false);
  const [reportMode, setReportMode]           = useState<"finance" | "sales">("finance");
  const [isGraphicModeEnabled, setIsGraphicModeEnabled] = useState(false);
  const [dashPeriod, setDashPeriod]           = useState<Period>("all");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { theme, toggleTheme }  = useTheme();
  const auth                    = useAuth();
  const preview                 = usePreview(auth.token);

  const dashboard = useDashboard(auth.token, auth.isLoggedIn, () => {
    auth.logout();
  }, dashPeriod, setDashPeriod);

  const admin = useAdmin(auth.token, dashboard.fetchDashboardData, preview.openRaw);

  const chat = useChat(auth.token, auth.threadId, isGraphicModeEnabled, dashboard.fetchDashboardData);

  const financeData = useFinanceChartData(dashboard.financeCharts, dashboard.salesKpi);

  // ── Auth login wrapper ──
  const handleLogin = async (e?: React.FormEvent, customCreds?: { email: string; role: string }) => {
    if (e) e.preventDefault();
    const email    = customCreds ? customCreds.email : loginEmail;
    const password = customCreds ? "demopassword" : loginPassword;
    const err = await auth.login(email, password);
    if (err) { alert(err); return; }
    chat.addWelcomeMessage();
    admin.fetchUploadedFiles();
  };

  const handleLogout = () => {
    auth.logout();
    chat.clearMessages();
    dashboard.resetDashboard();
  };

  // ── Local login form state (only needed until logged in) ──
  const [loginEmail, setLoginEmail]       = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // ── Auto-scroll ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  // ── Fetch files on login ──
  useEffect(() => {
    if (auth.isLoggedIn && auth.token) admin.fetchUploadedFiles();
  }, [auth.isLoggedIn, auth.token]);

  const hasDataset = admin.uploadedFiles.length > 0;

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground/80 font-sans antialiased text-xs flex flex-col transition-colors duration-200">
      <Header
        serverStatus={dashboard.serverStatus} isLoggedIn={auth.isLoggedIn} user={auth.user} theme={theme}
        onToggleTheme={toggleTheme} onLogout={handleLogout}
        activeTab={activeTab} onTabChange={setActiveTab}
      />

      <OfflineBanner />

      {!auth.isLoggedIn ? (
        <LoginForm
          email={loginEmail} password={loginPassword} isAuthLoading={auth.isAuthLoading}
          onEmailChange={setLoginEmail} onPasswordChange={setLoginPassword} onLogin={handleLogin}
        />
      ) : (
        <div className="relative flex-1 flex flex-col min-h-0">

          {/* ── ASK TAB ── */}
          {activeTab === "ask" && (
            <main key="tab-ask" className="flex-1 flex overflow-hidden min-h-0 animate-fade-in-up">
              <section className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background relative">
                {/* Routing indicator */}
                <div className="border-b border-border py-2.5 px-6 flex items-center justify-between bg-sidebar/50 transition-colors duration-200">
                  <div className="flex items-center gap-1.5 text-foreground/50 text-[10px] uppercase font-bold tracking-wider">
                    <span className={`w-1.5 h-1.5 rounded-full ${chat.activeRoutingState !== "idle" && chat.activeRoutingState !== "done" ? "bg-foreground animate-pulse" : "bg-foreground/30"}`} />
                    Шинжилгээний замнал
                  </div>
                  <div className="flex gap-4 items-center font-mono text-[9px]">
                    <span className={chat.activeRoutingState === "routing" ? "text-foreground font-bold" : "text-foreground/40"}>Router</span>
                    <span className="text-foreground/30">→</span>
                    <span className={chat.activeRoutingState === "finance" ? "text-foreground font-bold" : "text-foreground/40"}>FinanceAgent</span>
                    <span className="text-foreground/30">/</span>
                    <span className={chat.activeRoutingState === "tech" ? "text-foreground font-bold" : "text-foreground/40"}>TechAgent</span>
                  </div>
                </div>

                {/* Chat messages */}
                <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-6 flex flex-col justify-start">
                  {chat.messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center my-auto gap-6">
                      <div className="text-center text-foreground/40">
                        <p className="font-semibold">Шинжилгээний хэлхээ идэвхтэй.</p>
                        <p className="text-[10px] mt-1">Доорх саналуудаас сонгох эсвэл өөрөө асуултаа бичнэ үү.</p>
                      </div>
                      <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                        {SUGGESTIONS_INITIAL.map((s, i) => (
                          <button key={i} onClick={() => chat.handleSendMessage(undefined, s.query)}
                            className="px-3 py-1.5 text-xs bg-sidebar border border-border rounded hover:bg-foreground/5 hover:border-foreground/30 text-foreground/70 transition-all cursor-pointer animate-fade-in-up inline-flex items-center gap-1.5"
                            style={{ animationDelay: `${i * 50}ms` }}>
                            {s.icon}<span>{s.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    chat.messages.map((msg) => (
                      <div key={msg.id} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"} animate-fade-in-up`}>
                        <div className="max-w-2xl w-full flex flex-col">
                          {msg.sender === "user" ? (
                            <div className="bg-foreground text-background border border-foreground/10 rounded-2xl px-4 py-2.5 text-xs max-w-[80%] self-end shadow-sm">{msg.text}</div>
                          ) : (
                            <div className="flex flex-col gap-1 border-l border-border pl-4 py-0.5">
                              {msg.agentName && <span className="text-[9px] text-foreground/50 font-bold uppercase tracking-wider">{msg.agentName}</span>}
                              <div className="text-foreground/90 text-xs">
                                {formatMessageText(msg.text)}
                                {msg.text === "" && (
                                  <div className="flex gap-1 items-center py-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-[bounce_1s_infinite]" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-[bounce_1s_infinite_0.2s]" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-[bounce_1s_infinite_0.4s]" />
                                  </div>
                                )}
                              </div>
                              {msg.text && !chat.isChatLoading && (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <button onClick={() => chat.handleFeedback(msg.id, "positive")}
                                    className={`text-[10px] px-1.5 py-0.5 rounded transition-all cursor-pointer ${chat.feedbackState[msg.id] === "positive" ? "text-emerald-500 bg-emerald-500/10 border border-emerald-500/30" : "text-foreground/40 hover:text-emerald-500 hover:bg-emerald-500/5 border border-transparent"}`}
                                    title="Сайн хариуллаа" disabled={!!chat.feedbackState[msg.id]}>
                                    <ThumbsUp className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => chat.handleFeedback(msg.id, "negative")}
                                    className={`text-[10px] px-1.5 py-0.5 rounded transition-all cursor-pointer ${chat.feedbackState[msg.id] === "negative" ? "text-red-500 bg-red-500/10 border border-red-500/30" : "text-foreground/40 hover:text-red-500 hover:bg-red-500/5 border border-transparent"}`}
                                    title="Буруу хариуллаа" disabled={!!chat.feedbackState[msg.id]}>
                                    <ThumbsDown className="w-3 h-3" />
                                  </button>
                                  {chat.feedbackSentMsgs[msg.id] && chat.feedbackState[msg.id] && (
                                    <span className="text-[9px] text-foreground/50 ml-1">{chat.feedbackSentMsgs[msg.id]}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  {chat.messages.length > 0 && chat.lastAgentType && FOLLOW_UP_SUGGESTIONS[chat.lastAgentType] && !chat.isChatLoading && (
                    <div className="flex flex-wrap gap-2 justify-start max-w-2xl pt-2">
                      {FOLLOW_UP_SUGGESTIONS[chat.lastAgentType].map((s, i) => (
                        <button key={i} onClick={() => chat.handleSendMessage(undefined, s.query)}
                          className="px-2.5 py-1 text-[10px] bg-sidebar border border-border rounded hover:bg-foreground/5 hover:border-foreground/30 text-foreground/50 transition-all cursor-pointer animate-fade-in-up"
                          style={{ animationDelay: `${i * 50}ms` }}>{s.label}</button>
                      ))}
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <ChatInput
                  input={chat.input} isChatLoading={chat.isChatLoading} streamEnabled={chat.streamEnabled}
                  isGraphicModeEnabled={isGraphicModeEnabled} threadId={auth.threadId}
                  onInputChange={chat.setInput} onStreamEnabledChange={chat.setStreamEnabled}
                  onGraphicModeToggle={() => setIsGraphicModeEnabled(!isGraphicModeEnabled)}
                  onSubmit={chat.handleSendMessage} onCancel={chat.handleCancelMessage}
                />
              </section>
            </main>
          )}

          {/* ── DASHBOARD TAB ── */}
          {activeTab === "dashboard" && (
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
                  user={auth.user}
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
                ) : dashboard.isDashboardLoading ? (
                  <PageLoading />
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center gap-2 md:hidden">
                      <button onClick={() => setSidebarOpen(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-border rounded bg-sidebar text-foreground/60 hover:text-foreground transition-colors cursor-pointer">
                        Удирдлага
                      </button>
                    </div>

                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-fade-in-up">
                      <PageHeaderContent currentUser={{
                        avatar: auth.user?.email?.charAt(0).toUpperCase(),
                        name: auth.user?.email?.split("@")[0] || "Хэрэглэгч",
                        title: "Өгөгдлийн шинжээч", group: "Аналитик хэлтэс",
                      }} />
                      <ExtraContent />
                    </div>

                    {/* Period selector */}
                    <div className="flex items-center gap-2 animate-fade-in-up">
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

                    <div className="animate-fade-in-up" style={{ animationDelay: "50ms" }}>
                      <KpiGrid salesKpi={dashboard.salesKpi} usersKpi={dashboard.usersKpi} churnKpi={dashboard.churnKpi} computedMetrics={dashboard.computedMetrics} salesHistory={dashboard.salesHistory} isLoading={dashboard.isDashboardLoading} />
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

                    {auth.token && (
                      <div className="animate-fade-in-up" style={{ animationDelay: "80ms" }}>
                        <FinanceDashboard token={auth.token} />
                      </div>
                    )}

                    <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
                      <IntroduceRow
                        totalSales={financeData.financeSummary?.totalIncome ?? dashboard.salesKpi?.current}
                        totalVisits={financeData.financeCounterparties?.length ?? dashboard.usersKpi?.current}
                        transactionCount={financeData.financeSummary?.totalTransactions}
                        operatingProfit={financeData.financeSummary?.operatingProfit}
                        visitData={financeData.financeMonthlyIncome ?? undefined}
                        campaignEffect={financeData.financeSummary?.totalIncome
                          ? Math.min(100, Math.max(0, Math.round((financeData.financeSummary.operatingProfit / financeData.financeSummary.totalIncome) * 100)))
                          : undefined}
                      />
                    </div>

                    <div className="animate-fade-in-up" style={{ animationDelay: "150ms" }}>
                      <SalesCard
                        salesData={financeData.financeMonthlyIncome ?? (dashboard.salesHistory.length > 0 ? dashboard.salesHistory.map(h => ({ x: h.month, y: h.revenue })) : undefined)}
                        expenseData={financeData.financeMonthlyExpense ?? undefined}
                        rankingData={financeData.financeExpenseCategories?.map(c => ({ title: c.name, total: Math.round(c.share * (financeData.financeSummary?.totalExpense ?? 0)) })) ?? undefined}
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

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-fade-in-up" style={{ animationDelay: "300ms" }}>
                      <div className="lg:col-span-2">
                        <OfflineData
                          categories={financeData.financeExpenseCategories ?? undefined}
                          monthlyExpenses={(() => {
                            const esc = dashboard.financeCharts?.charts?.find((c: any) => c.id === "monthly_expense_subcat");
                            if (!esc?.data) return undefined;
                            const result: Record<string, { month: string; amount: number }[]> = {};
                            const subcats = Object.keys(esc.data[0] || {}).filter((k: string) => k !== "label");
                            for (const sub of subcats) {
                              result[sub] = esc.data.map((d: any) => ({ month: String(d.label ?? ""), amount: Number(d[sub] ?? 0) }));
                            }
                            return result;
                          })()}
                        />
                      </div>
                      <div className="flex flex-col gap-4">
                        <div className="border border-border/60 rounded-xl p-6 bg-card shadow-sm flex flex-col items-center justify-center">
                          <Gauge
                            percent={financeData.financeSummary
                              ? Math.min(100, Math.round((financeData.financeSummary.totalIncome / (dashboard.salesKpi?.target ?? 200_000_000)) * 100))
                              : dashboard.salesKpi ? Math.min(100, Math.round((dashboard.salesKpi.current / dashboard.salesKpi.target) * 100)) : 89}
                            title="Орлогын гүйцэтгэл" size={210}
                          />
                        </div>
                        <div className="border border-border/60 rounded-xl p-6 bg-card shadow-sm flex flex-col items-center justify-center gap-3">
                          <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider">Дүүргэлт</span>
                          <Liquid
                            percent={financeData.financeSummary
                              ? Math.min(1, financeData.financeSummary.totalIncome / (dashboard.salesKpi?.target ?? 200_000_000))
                              : dashboard.salesKpi ? Math.min(1, dashboard.salesKpi.current / (dashboard.salesKpi.target * 1.15)) : 0.50}
                            height={130}
                          />
                        </div>
                        <div className="border border-border/60 rounded-xl p-4 bg-card shadow-sm flex-1 flex flex-col">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="block w-0.5 h-4 rounded-full bg-purple-500" />
                            <p className="text-[11px] font-bold text-foreground/60 uppercase tracking-wider">Үзүүлэлтийн харьцуулалт</p>
                          </div>
                          <div className="flex-1">
                            <Radar data={financeData.financeRadarData ?? undefined} height={260} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <Footer />
                  </div>
                )}
              </section>
            </main>
          )}

          {/* ── REPORT TAB ── */}
          {activeTab === "report" && (
            <main key="tab-report" className="flex-1 flex flex-col overflow-hidden min-h-0 animate-fade-in-up">
              <div className="border-b border-border px-6 py-2 flex items-center gap-2 bg-sidebar/30">
                <span className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Тайлангийн төрөл:</span>
                <div className="flex items-center border border-border rounded overflow-hidden text-[10px] font-bold">
                  <button onClick={() => setReportMode("finance")}
                    className={`px-2.5 py-1 uppercase tracking-wider transition-colors cursor-pointer ${reportMode === "finance" ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground"}`}>
                    Санхүү
                  </button>
                  <button onClick={() => setReportMode("sales")}
                    className={`px-2.5 py-1 uppercase tracking-wider transition-colors cursor-pointer ${reportMode === "sales" ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground"}`}>
                    Борлуулалт
                  </button>
                </div>
              </div>
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                {reportMode === "finance" ? <FinanceReportView token={auth.token!} /> : <ReportView token={auth.token!} />}
              </div>
            </main>
          )}

          <PreviewDrawer
            previewData={preview.preview.data} previewColumns={preview.preview.columns}
            previewTableName={preview.preview.tableName} previewDescription={preview.preview.description}
            previewContent={preview.preview.content} previewHasDownload={preview.preview.hasDownload}
            previewFileId={preview.preview.fileId} onClose={preview.close}
          />
        </div>
      )}
    </div>
  );
}
