"use client";

import React, { useState, useEffect, useRef } from "react";
import { BarChart2, Activity, TrendingUp, TrendingDown, PieChart as PieChartIcon, ArrowUp, Sparkles, PanelLeftClose, PanelLeft, Download } from "lucide-react";

import { Header, type TabId } from "../components/Header";
import { PreviewDrawer } from "../components/PreviewDrawer";
import { OfflineBanner } from "../components/OfflineBanner";
import { AskTab, DashboardTab, ReportTab } from "../components/tabs";
import { ConversationSidebar } from "../components/ConversationSidebar";
import { LoginPage } from "../components/LoginPage";
import { GlossaryBrowser } from "../components/GlossaryBrowser";
import { DataQualityDashboard } from "../components/DataQualityDashboard";
import { DataLineageView } from "../components/DataLineageView";
import { ReportScheduler } from "../components/ReportScheduler";
import { SharingPanel } from "../components/SharingPanel";

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
    const target = Number(salesKpi?.target ?? 0);
    const totalIncome = Number(financeSummary.totalIncome ?? 0);
    const totalExpense = Number(financeSummary.totalExpense ?? 0);
    const operatingProfit = Number(financeSummary.operatingProfit ?? 0);
    const incomeScore  = target > 0 && totalIncome > 0 ? Math.min(100, Math.round((totalIncome / target) * 100)) : 0;
    const expenseRatio = totalIncome > 0 ? Math.round((1 - totalExpense / totalIncome) * 100) : 0;
    const profitScore  = totalIncome > 0 ? Math.min(100, Math.round((operatingProfit / totalIncome) * 100 * 5)) : 0;
    return [
      { subject: "Нийт орлого",               A: Math.min(100, incomeScore), fullMark: 100 },
      { subject: "Зарлагын хяналт",            A: Math.min(100, expenseRatio), fullMark: 100 },
      { subject: "ҮА ашиг",                    A: Math.min(100, profitScore), fullMark: 100 },
      { subject: "Гүйлгээний тоо",             A: 0, fullMark: 100 },
      { subject: "Мөнгөн урсгал",              A: operatingProfit > 0 ? 70 : 0, fullMark: 100 },
      { subject: "Санхүүгийн тогтвортой байдал", A: Math.min(100, Math.round((incomeScore + expenseRatio + profitScore) / 3)), fullMark: 100 },
    ];
  })();

  return { financeSummary, financePeriod, financeMonthlyIncome, financeMonthlyExpense, financeExpenseCategories, financeExpensePieData, financeCounterparties, financeCashData, financeRadarData };
}

export default function Home() {
  const [activeTab, setActiveTab]             = useState<TabId>("ask");
  const [sidebarOpen, setSidebarOpen]         = useState(false);
  const [reportMode, setReportMode]           = useState<"finance" | "sales">("finance");
  const [isGraphicModeEnabled, setIsGraphicModeEnabled] = useState(false);
  const [dashPeriod, setDashPeriod]           = useState<Period>("all");
  const [convoSidebarOpen, setConvoSidebarOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);

  const { theme, toggleTheme }  = useTheme();
  const auth                    = useAuth();
  const preview                 = usePreview();

  const dashboard = useDashboard(dashPeriod, setDashPeriod);
  const admin = useAdmin(dashboard.fetchDashboardData, preview.openRaw);
  const conversation = useConversation(auth.token);
  const chat = useChat(auth.threadId, isGraphicModeEnabled, dashboard.fetchDashboardData, auth.token);
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
    const newThreadId = `thread_${Date.now()}`;
    auth.setThreadId(newThreadId);
  };

  const handleSelectConversation = async (id: string) => {
    setActiveConversationId(id);
    const messages = await conversation.loadMessages(id);
    if (messages.length > 0) {
      chat.clearMessages();
      messages.forEach(m => {
        if (m.role === "user") {
          chat.addUserMessage(m.content);
        } else {
          chat.addSystemMessage(m.content, m.agentType ?? undefined);
        }
      });
      // Update threadId so new messages continue in this conversation
      const conv = conversation.conversations.find(c => c.id === id);
      if (conv?.threadId) {
        auth.setThreadId(conv.threadId);
      }
    }
  };

  const handleDeleteConversation = async (id: string) => {
    if (!window.confirm("Энэ чатыг устгах уу?")) return;
    await conversation.deleteConversation(id);
    if (activeConversationId === id) {
      setActiveConversationId(null);
      chat.clearMessages();
    }
  };

  const handleRenameConversation = async (id: string, title: string) => {
    await conversation.renameConversation(id, title);
  };

  // Smart auto-scroll: only scroll if user hasn't manually scrolled up
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      isUserScrolledUp.current = !atBottom;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!isUserScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chat.messages]);

  // Fetch files on mount — only after auth is ready
  useEffect(() => {
    if (auth.isLoggedIn) admin.fetchUploadedFiles();
  }, [auth.isLoggedIn]);

  // Fetch chat history on mount
  useEffect(() => {
    if (auth.isLoggedIn) {
      conversation.fetchConversations();
    }
  }, [auth.isLoggedIn]);

  // #2.2: Auto-load most recent conversation on mount (survives page refresh)
  const didAutoRestore = useRef(false);
  useEffect(() => {
    if (!auth.isLoggedIn || didAutoRestore.current) return;
    didAutoRestore.current = true;
    (async () => {
      try {
        const res = await fetch("/api/conversations?limit=1", {
          headers: { "Content-Type": "application/json", ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}) },
        });
        const data = await res.json();
        if (data.success && data.data?.length > 0) {
          const latest = data.data[0];
          const msgs = await conversation.loadMessages(latest.id);
          if (msgs.length > 0) {
            setActiveConversationId(latest.id);
            chat.clearMessages();
            msgs.forEach(m => {
              if (m.role === "user") {
                chat.addUserMessage(m.content);
              } else {
                chat.addSystemMessage(m.content, m.agentType ?? undefined);
              }
            });
            // Restore threadId so new messages continue this conversation
            if (latest.threadId) {
              auth.setThreadId(latest.threadId);
            }
          }
        }
      } catch { /* best-effort */ }
    })();
  }, [auth.isLoggedIn]);

  // Refresh chat history when sidebar opens
  useEffect(() => {
    if (convoSidebarOpen) {
      conversation.fetchConversations();
    }
  }, [convoSidebarOpen]);

  // #4: Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // Ctrl+Shift+E — export conversation
      if (mod && e.shiftKey && e.key === "E") {
        e.preventDefault();
        chat.exportConversation("md");
      }
      // Ctrl+F — open in-conversation search (dispatch custom event)
      if (mod && e.key === "f" && activeTab === "ask") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("chat-search-open"));
      }
      // Escape — close sidebar
      if (e.key === "Escape" && convoSidebarOpen) {
        setConvoSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [convoSidebarOpen, chat, activeTab]);

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
              onRename={handleRenameConversation}
              onPin={conversation.pinConversation}
              onAddTag={conversation.addTag}
              onRemoveTag={conversation.removeTag}
              isOpen={convoSidebarOpen}
              onClose={() => setConvoSidebarOpen(false)}
            />

            {/* Main chat area */}
            <div className="flex-1 flex flex-col min-h-0">
              {/* Sidebar toggle + Export */}
              <div className="flex items-center px-3 py-1.5 border-b border-border">
                <button onClick={() => setConvoSidebarOpen(!convoSidebarOpen)}
                  className="flex items-center gap-1.5 px-2 py-1 text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5 rounded-md transition-all cursor-pointer"
                  title={convoSidebarOpen ? "Чат түүх нуух" : "Чат түүх харах"}>
                  {convoSidebarOpen ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeft className="w-3.5 h-3.5" />}
                  <span className="text-[10px]">Түүх</span>
                </button>
                {chat.messages.length > 0 && (
                  <button onClick={() => chat.exportConversation("md")}
                    className="flex items-center gap-1.5 px-2 py-1 ml-auto text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5 rounded-md transition-all cursor-pointer"
                    title="Татаж авах (Markdown)">
                    <Download className="w-3.5 h-3.5" />
                    <span className="text-[10px]">Татаж авах</span>
                  </button>
                )}
              </div>

              <AskTab
                chat={{
                  ...chat,
                  handleRegenerate: chat.handleRegenerate,
                  handleStopAndRegenerate: chat.handleStopAndRegenerate,
                  exportConversation: chat.exportConversation,
                }}
                isGraphicModeEnabled={isGraphicModeEnabled}
                setIsGraphicModeEnabled={setIsGraphicModeEnabled}
                threadId={auth.threadId}
                activeSuggestions={activeSuggestions}
                followUpSuggestions={chat.dynamicSuggestions}
                messagesEndRef={messagesEndRef}
                scrollContainerRef={scrollContainerRef}
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

        {activeTab === "glossary" && (
          <div id="panel-glossary" role="tabpanel" aria-label="Толь бичиг" className="flex-1 min-h-0 flex flex-col">
            <GlossaryBrowser token={auth.token} />
          </div>
        )}

        {activeTab === "quality" && (
          <div id="panel-quality" role="tabpanel" aria-label="Өгөгдлийн чанар" className="flex-1 min-h-0 flex flex-col">
            <DataQualityDashboard token={auth.token} />
          </div>
        )}

        {activeTab === "lineage" && (
          <div id="panel-lineage" role="tabpanel" aria-label="Lineage" className="flex-1 min-h-0 flex flex-col">
            <DataLineageView token={auth.token} />
          </div>
        )}

        {activeTab === "scheduler" && (
          <div id="panel-scheduler" role="tabpanel" aria-label="Тайлангийн хуваарь" className="flex-1 min-h-0 flex flex-col">
            <ReportScheduler token={auth.token} />
          </div>
        )}

        {activeTab === "sharing" && (
          <div id="panel-sharing" role="tabpanel" aria-label="Хамтын ажиллагаа" className="flex-1 min-h-0 flex flex-col">
            <SharingPanel token={auth.token} />
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
