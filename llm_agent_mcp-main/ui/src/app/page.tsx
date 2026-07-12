"use client";

import React, { useState, useEffect, useRef } from "react";
import { BarChart2, Activity, TrendingUp, TrendingDown, PieChart as PieChartIcon, ArrowUp, Sparkles, PanelLeftClose, PanelLeft } from "lucide-react";

import { Header } from "../components/Header";
import { PreviewDrawer } from "../components/PreviewDrawer";
import { OfflineBanner } from "../components/OfflineBanner";
import { AskTab, DashboardTab, ReportTab } from "../components/tabs";
import { ConversationSidebar } from "../components/ConversationSidebar";
import { LoginPage } from "../components/LoginPage";

import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { useChat } from "../hooks/useChat";
import { useDashboard, type Period } from "../hooks/useDashboard";
import { useAdmin } from "../hooks/useAdmin";
import { usePreview } from "../hooks/usePreview";
import { useConversation } from "../hooks/useConversation";

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

import type { KpiData, ComputedMetrics } from "../components/types";

function useFinanceChartData(financeCharts: Record<string, unknown> | null, salesKpi: KpiData | null) {
  const financeSummary        = (financeCharts?.summary as Record<string, unknown>) ?? null;
  const financePeriod         = financeCharts?.period as string | undefined;
  const charts                = (financeCharts?.charts as Array<Record<string, unknown>>) ?? [];
  const findChart             = (id: string) => charts.find((c) => c.id === id);

  const financeMonthlyIncome = (() => {
    const cf = findChart("monthly_cashflow");
    const data = (cf?.data as Array<Record<string, unknown>>) ?? [];
    return data.map((d) => ({ x: String(d.label ?? ""), y: Number(d["Орлого"] ?? 0) })) ?? null;
  })();

  const financeMonthlyExpense = (() => {
    const cf = findChart("monthly_cashflow");
    const data = (cf?.data as Array<Record<string, unknown>>) ?? [];
    return data.map((d) => ({ x: String(d.label ?? ""), y: Number(d["Зарлага"] ?? 0) })) ?? null;
  })();

  const financeExpenseCategories: { name: string; share: number; color: string }[] | null = (() => {
    const cb = findChart("category_breakdown");
    const data = (cb?.data as Array<Record<string, unknown>>) ?? [];
    if (data.length === 0) return null;
    const total = data.reduce((s, d) => s + Number(d.value ?? 0), 0);
    return data.map((d, i) => ({
      name: String(d.label ?? ""), share: total > 0 ? Number(d.value ?? 0) / total : 0,
      color: ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6"][i % 7],
    }));
  })();

  const financeExpensePieData = (() => {
    const cb = findChart("category_breakdown");
    const data = (cb?.data as Array<Record<string, unknown>>) ?? [];
    return data.map((d) => ({ x: String(d.label ?? ""), y: Number(d.value ?? 0) })) ?? null;
  })();

  const financeCounterparties = (() => {
    const tp = findChart("top_parties");
    const data = (tp?.data as Array<Record<string, unknown>>) ?? [];
    if (data.length === 0) return null;
    const total = data.reduce((s, d) => s + Number(d.value ?? 0), 0);
    return data.map((d, i) => ({
      index: i + 1, name: String(d.label ?? ""), amount: Number(d.value ?? 0),
      share: total > 0 ? Math.round((Number(d.value ?? 0) / total) * 1000) / 10 : 0,
    }));
  })();

  const financeCashData = (() => {
    const dt = findChart("daily_trend");
    const data = (dt?.data as Array<Record<string, unknown>>) ?? [];
    if (data.length === 0) return null;
    let cumulative = 0;
    return data.map((d) => { cumulative += Number(d.value ?? 0); return { x: String(d.label ?? ""), y: cumulative }; });
  })();

  const financeRadarData = (() => {
    if (!financeSummary) return null;
    const target = Number((salesKpi?.target as number) ?? 200_000_000);
    const totalIncome = Number(financeSummary.totalIncome ?? 0);
    const totalExpense = Number(financeSummary.totalExpense ?? 0);
    const operatingProfit = Number(financeSummary.operatingProfit ?? 0);
    const incomeScore  = totalIncome > 0 ? Math.min(100, Math.round((totalIncome / target) * 100)) : 50;
    const expenseRatio = totalIncome > 0 ? Math.round((1 - totalExpense / totalIncome) * 100) : 50;
    const profitScore  = totalIncome > 0 ? Math.min(100, Math.round((operatingProfit / totalIncome) * 100 * 5)) : 50;
    return [
      { subject: "Нийт орлого",               A: Math.min(100, incomeScore), fullMark: 100 },
      { subject: "Зарлагын хяналт",            A: Math.min(100, expenseRatio), fullMark: 100 },
      { subject: "ҮА ашиг",                    A: Math.min(100, profitScore), fullMark: 100 },
      { subject: "Гүйлгээний тоо",             A: 85, fullMark: 100 },
      { subject: "Мөнгөн урсгал",              A: operatingProfit > 0 ? 70 : 40, fullMark: 100 },
      { subject: "Санхүүгийн тогтвортой байдал", A: Math.min(100, Math.round((incomeScore + expenseRatio + profitScore) / 3)), fullMark: 100 },
    ];
  })();

  return { financeSummary, financePeriod, financeMonthlyIncome, financeMonthlyExpense, financeExpenseCategories, financeExpensePieData, financeCounterparties, financeCashData, financeRadarData };
}

export default function Home() {
  const [activeTab, setActiveTab]             = useState<"ask" | "dashboard" | "report">("ask");
  const [sidebarOpen, setSidebarOpen]         = useState(false);
  const [reportMode, setReportMode]           = useState<"finance" | "sales">("finance");
  const [isGraphicModeEnabled, setIsGraphicModeEnabled] = useState(false);
  const [dashPeriod, setDashPeriod]           = useState<Period>("all");
  const [convoSidebarOpen, setConvoSidebarOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { theme, toggleTheme }  = useTheme();
  const auth                    = useAuth();
  const preview                 = usePreview();

  const dashboard = useDashboard(dashPeriod, setDashPeriod);
  const admin = useAdmin(dashboard.fetchDashboardData, preview.openRaw);
  const conversation = useConversation(auth.token);
  const chat = useChat(auth.threadId, isGraphicModeEnabled, dashboard.fetchDashboardData);
  const financeData = useFinanceChartData(dashboard.financeCharts, dashboard.salesKpi);

  // Dynamic suggestion cards
  const activeSuggestions = (dashboard.tablePassport?.available && dashboard.tablePassport.questions?.length)
    ? dashboard.tablePassport.questions.map((q: string) => ({
        label: q.length > 16 ? q.slice(0, 15) + "…" : q,
        query: q,
        icon: <Sparkles className="w-3 h-3" />,
      }))
    : SUGGESTIONS_INITIAL;

  const handleLogout = () => {
    chat.clearMessages();
    dashboard.resetDashboard();
    setConvoSidebarOpen(false);
    setActiveConversationId(null);
    auth.logout();
  };

  const handleNewChat = async () => {
    chat.clearMessages();
    setActiveConversationId(null);
  };

  const handleSelectConversation = async (id: string) => {
    setActiveConversationId(id);
    const messages = await conversation.loadMessages(id);
    if (messages.length > 0) {
      chat.clearMessages();
      messages.forEach(m => {
        chat.addSystemMessage(m.content, m.agentType ?? undefined);
      });
    }
  };

  const handleDeleteConversation = async (id: string) => {
    await conversation.deleteConversation(id);
    if (activeConversationId === id) {
      setActiveConversationId(null);
      chat.clearMessages();
    }
  };

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  // Fetch files on mount
  useEffect(() => {
    admin.fetchUploadedFiles();
  }, []);

  const hasDataset = admin.uploadedFiles.length > 0;

  // Show login page if not logged in
  if (!auth.isAuthLoading && !auth.isLoggedIn) {
    return <LoginPage onLogin={auth.login} onRegister={auth.register} />;
  }

  if (auth.isAuthLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-foreground/40 text-xs">Ачаалж байна...</div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground/80 font-sans antialiased text-xs flex flex-col transition-colors duration-200">
      <Header
        serverStatus={dashboard.serverStatus} isLoggedIn={auth.isLoggedIn} user={auth.user} theme={theme}
        onToggleTheme={toggleTheme} onLogout={handleLogout}
        activeTab={activeTab} onTabChange={setActiveTab}
      />

      <OfflineBanner />

      <div className="relative flex-1 flex flex-col min-h-0">
        {activeTab === "ask" && (
          <div id="panel-ask" role="tabpanel" aria-label="Асуулт" className="flex-1 flex min-h-0">
            {/* Conversation Sidebar */}
            <ConversationSidebar
              conversations={conversation.conversations}
              isLoading={conversation.isLoading}
              searchQuery={conversation.searchQuery}
              activeConversationId={activeConversationId}
              onSearchChange={conversation.setSearchQuery}
              onSearch={conversation.searchConversationsList}
              onSelect={handleSelectConversation}
              onDelete={handleDeleteConversation}
              onNewChat={handleNewChat}
              isOpen={convoSidebarOpen}
              onClose={() => setConvoSidebarOpen(false)}
            />

            {/* Main chat area */}
            <div className="flex-1 flex flex-col min-h-0">
              {/* Sidebar toggle */}
              <div className="flex items-center px-3 py-1.5 border-b border-border">
                <button onClick={() => setConvoSidebarOpen(!convoSidebarOpen)}
                  className="flex items-center gap-1.5 px-2 py-1 text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5 rounded-md transition-all cursor-pointer"
                  title={convoSidebarOpen ? "Чат түүх нуух" : "Чат түүх харах"}>
                  {convoSidebarOpen ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeft className="w-3.5 h-3.5" />}
                  <span className="text-[10px]">Түүх</span>
                </button>
              </div>

              <AskTab
                chat={chat}
                isGraphicModeEnabled={isGraphicModeEnabled}
                setIsGraphicModeEnabled={setIsGraphicModeEnabled}
                threadId={auth.threadId}
                activeSuggestions={activeSuggestions}
                followUpSuggestions={FOLLOW_UP_SUGGESTIONS}
                messagesEndRef={messagesEndRef}
              />
            </div>
          </div>
        )}

        {activeTab === "dashboard" && (
          <div id="panel-dashboard" role="tabpanel" aria-label="Dashboard" className="flex-1 min-h-0 flex flex-col">
            <DashboardTab
              user={auth.user!}
              token={auth.token}
              hasDataset={hasDataset}
              isDashboardLoading={dashboard.isDashboardLoading}
              dashboard={{
                period: dashPeriod,
                setPeriod: setDashPeriod,
                salesKpi: dashboard.salesKpi,
                usersKpi: dashboard.usersKpi,
                churnKpi: dashboard.churnKpi,
                computedMetrics: dashboard.computedMetrics,
                salesHistory: dashboard.salesHistory,
                financeAudit: dashboard.financeAudit,
                financeCharts: dashboard.financeCharts,
                fetchDashboardData: dashboard.fetchDashboardData,
              }}
              financeData={financeData}
              admin={admin}
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              preview={{ open: preview.open }}
            />
          </div>
        )}

        {activeTab === "report" && (
          <div id="panel-report" role="tabpanel" aria-label="Тайлан" className="flex-1 min-h-0 flex flex-col">
            <ReportTab reportMode={reportMode} setReportMode={setReportMode} />
          </div>
        )}

        <PreviewDrawer
          previewData={preview.preview.data} previewColumns={preview.preview.columns}
          previewTableName={preview.preview.tableName} previewDescription={preview.preview.description}
          previewContent={preview.preview.content} previewHasDownload={preview.preview.hasDownload}
          previewFileId={preview.preview.fileId} onClose={preview.close}
        />
      </div>
    </div>
  );
}
