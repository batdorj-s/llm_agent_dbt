"use client";

import React, { useState, useEffect, useRef } from "react";
import { BarChart2, Activity, TrendingUp, PieChart as PieChartIcon, LayoutDashboard, Upload, ThumbsUp, ThumbsDown, FileText } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { chartTheme } from "../components/chartTheme";

import { Message, KpiData, SalesHistory, UploadedFile, ServerStatus, ComputedMetrics } from "../components/types";
import { Header } from "../components/Header";
import { LoginForm } from "../components/LoginForm";
import { KpiGrid } from "../components/KpiGrid";
import { ReportView } from "../components/ReportView";
import { AdminPanel } from "../components/AdminPanel";
import { ChatInput } from "../components/ChatInput";
import { PreviewDrawer } from "../components/PreviewDrawer";
import { formatMessageText } from "../components/ChatMessage";

export default function Home() {
  // ── Auth ──
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [threadId, setThreadId] = useState<string>("");

  // ── Chat ──
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [lastAgentType, setLastAgentType] = useState<string | null>(null);

  // ── Preview ──
  const [previewData, setPreviewData] = useState<Record<string, unknown>[] | null>(null);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [previewTableName, setPreviewTableName] = useState("");
  const [previewDescription, setPreviewDescription] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewHasDownload, setPreviewHasDownload] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);

  // ── Dashboard / System ──
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [salesKpi, setSalesKpi] = useState<KpiData | null>(null);
  const [usersKpi, setUsersKpi] = useState<KpiData | null>(null);
  const [churnKpi, setChurnKpi] = useState<KpiData | null>(null);
  const [computedMetrics, setComputedMetrics] = useState<ComputedMetrics | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const [salesHistory, setSalesHistory] = useState<SalesHistory[]>([]);
  const [, setDashboardError] = useState<string | null>(null);
  type Period = "7d" | "1m" | "3m" | "6m" | "12m" | "all";
  const [period, setPeriod] = useState<Period>("all");

  function periodToDateRange(p: Period): { startDate?: string; endDate?: string } {
    const now = new Date();
    const end = now.toISOString().split("T")[0];
    const start = new Date(now);
    switch (p) {
      case "7d": start.setDate(start.getDate() - 7); break;
      case "1m": start.setMonth(start.getMonth() - 1); break;
      case "3m": start.setMonth(start.getMonth() - 3); break;
      case "6m": start.setMonth(start.getMonth() - 6); break;
      case "12m": start.setMonth(start.getMonth() - 12); break;
      case "all": return {};
    }
    return { startDate: start.toISOString().split("T")[0], endDate: end };
  }

  function periodToHistoryLimit(p: Period): number {
    switch (p) {
      case "7d": return 7;
      case "1m": return 30;
      case "3m": return 90;
      case "6m": return 180;
      case "12m": return 365;
      case "all": return 12;
    }
  }

  // ── Routing state ──
  const [activeRoutingState, setActiveRoutingState] = useState<"idle" | "routing" | "finance" | "tech" | "done">("idle");
  const [, setLastAgentResponded] = useState<string | null>(null);

  // ── Admin: Target Manager ──
  const [adjustMetric, setAdjustMetric] = useState<"sales" | "users" | "churn_rate">("sales");
  const [newTargetValue, setNewTargetValue] = useState<number>(200000);
  const [isUpdatingTarget, setIsUpdatingTarget] = useState<boolean>(false);
  const [salesUpdateSuccess, setSalesUpdateSuccess] = useState<string | null>(null);

  // ── Upload: CSV ──
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [tableNameInput, setTableNameInput] = useState<string>("");
  const [tableDescInput, setTableDescInput] = useState<string>("");
  const [isUploadingCsv, setIsUploadingCsv] = useState<boolean>(false);
  const [csvUploadMessage, setCsvUploadMessage] = useState<string | null>(null);

  // ── Upload: Excel ──
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelTableNameInput, setExcelTableNameInput] = useState<string>("");
  const [excelDescInput, setExcelDescInput] = useState<string>("");
  const [isUploadingExcel, setIsUploadingExcel] = useState<boolean>(false);
  const [excelUploadMessage, setExcelUploadMessage] = useState<string | null>(null);

  // ── Upload: Document ──
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docDescInput, setDocDescInput] = useState<string>("");
  const [isUploadingDoc, setIsUploadingDoc] = useState<boolean>(false);
  const [docUploadMessage, setDocUploadMessage] = useState<string | null>(null);

  // ── File Manager ──
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [, setIsFilesLoading] = useState(false);

  // ── Feedback ──
  const [feedbackState, setFeedbackState] = useState<Record<string, 'positive' | 'negative' | null>>({});
  const [feedbackSentMsgs, setFeedbackSentMsgs] = useState<Record<string, string>>({});

  // ── Graphic Mode ──
  const [isGraphicModeEnabled, setIsGraphicModeEnabled] = useState<boolean>(false);

  // ── Theme ──
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // ── Tab navigation ──
  const [activeTab, setActiveTab] = useState<"ask" | "dashboard" | "report">("ask");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Refs ──
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Suggestions ──
  const SUGGESTIONS_INITIAL: { label: string; query: string; icon: React.ReactNode }[] = [
    { label: "Борлуулалтын тайлан", query: "Борлуулалтын тайлан гаргаж өгнө үү", icon: <BarChart2 className="w-3 h-3" /> },
    { label: "KPI үзүүлэлт", query: "Гол KPI үзүүлэлтүүдийг харуул", icon: <Activity className="w-3 h-3" /> },
    { label: "Сегментчлэл", query: "Хэрэглэгчдийн сегментчлэлийн шинжилгээ хий", icon: <PieChartIcon className="w-3 h-3" /> },
    { label: "Таамаглал", query: "Дараагийн саруудын борлуулалтын таамаглал гарга", icon: <TrendingUp className="w-3 h-3" /> },
    { label: "Dashboard", query: "Dashboard харуул", icon: <LayoutDashboard className="w-3 h-3" /> },
    { label: "Upload", query: "Өгөгдөл Upload хэрхэн хийх вэ", icon: <Upload className="w-3 h-3" /> },
  ];

  const FOLLOW_UP_SUGGESTIONS: Record<string, { label: string; query: string }[]> = {
    "Finance Agent": [
      { label: "Дэлгэрэнгүй мэдээлэл", query: "Өмнөх хариултаа дэлгэрэнгүй тайлбарла" },
      { label: "Өмнөх сартай харьцуулах", query: "Өмнөх сарын үзүүлэлттэй харьцуул" },
      { label: "Графикаар харуул", query: "Энэ өгөгдлийг графикаар харуул" },
    ],
    "Tech Agent": [
      { label: "Top 5 харуул", query: "Хамгийн их борлуулалттай эхний 5-ыг харуул" },
      { label: "График зур", query: "Өгөгдлийн график зурж харуул" },
      { label: "Dashboard", query: "Энэ өгөгдлийг dashboard болгож харуул" },
    ],
    "DataScientistAgent": [
      { label: "Forecast шинэчлэх", query: "Шинэ өгөгдлөөр таамаглалаа шинэчил" },
      { label: "Cluster дэлгэрэнгүй", query: "Бүлэглэлтийн дэлгэрэнгүй шинжилгээ харуул" },
      { label: "Корреляцийн матриц", query: "Корреляцийн матриц харуул" },
    ],
  };

  // ── Theme effects ──
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    const storedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    if (storedTheme) setTheme(storedTheme);
    else setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  // ── Auth restore ──
  useEffect(() => {
    const storedToken = localStorage.getItem("agent_token");
    const storedUser = localStorage.getItem("agent_user");
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      setIsLoggedIn(true);
      setThreadId(`thread_${Date.now()}`);
    }
  }, []);

  // ── Server status ──
  useEffect(() => { fetchServerStatus(); }, []);

  // ── Dashboard data ──
  useEffect(() => {
    if (isLoggedIn && token) {
      fetchDashboardData();
      fetchUploadedFiles();
    }
  }, [isLoggedIn, token, period]);

  // ── Auto-scroll ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Theme helpers ──
  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("theme", next);
  };

  const handleLogout = () => {
    localStorage.removeItem("agent_token");
    localStorage.removeItem("agent_user");
    setToken(null); setUser(null); setIsLoggedIn(false);
    setMessages([]); setSalesKpi(null); setUsersKpi(null); setChurnKpi(null); setComputedMetrics(null); setSalesHistory([]); setIsDashboardLoading(true);
  };

  // ── Data fetching ──
  const fetchServerStatus = async () => {
    try { const res = await fetch("/api/status"); if (res.ok) setServerStatus(await res.json()); } catch {}
  };

  const fetchDashboardData = async () => {
    if (!token) { setIsDashboardLoading(false); return; }
    setIsDashboardLoading(true);
    try {
      setDashboardError(null);
      const headers = { Authorization: `Bearer ${token}` };
      const dr = periodToDateRange(period);
      const params = new URLSearchParams();
      params.set("limit", String(periodToHistoryLimit(period)));
      if (dr.startDate) params.set("startDate", dr.startDate);
      if (dr.endDate) params.set("endDate", dr.endDate);
      const qs = params.toString();

      const [salesRes, usersRes, churnRes, historyRes, computedRes] = await Promise.all([
        fetch(`/api/kpi/sales?${qs}`, { headers }),
        fetch(`/api/kpi/users?${qs}`, { headers }),
        fetch(`/api/kpi/churn_rate?${qs}`, { headers }),
        fetch(`/api/kpi-history?${qs}`, { headers }),
        fetch(`/api/dashboard/computed-metrics?${qs}`, { headers }),
      ]);
      if (salesRes.ok) setSalesKpi(await salesRes.json());
      else if (salesRes.status === 401) { handleLogout(); return; }
      if (usersRes.ok) setUsersKpi(await usersRes.json());
      if (churnRes.ok) setChurnKpi(await churnRes.json());
      if (historyRes.ok) setSalesHistory(await historyRes.json());
      if (computedRes.ok) setComputedMetrics(await computedRes.json());
    } catch { setDashboardError("Could not retrieve KPI data."); }
    finally { setIsDashboardLoading(false); }
  };

  const fetchUploadedFiles = async () => {
    if (!token) return;
    setIsFilesLoading(true);
    try {
      const res = await fetch("/api/admin/files", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setUploadedFiles(await res.json());
    } catch {} finally { setIsFilesLoading(false); }
  };

  // ── File ops ──
  const handleDeleteFile = async (id: string) => {
    if (!token || !confirm("Are you sure you want to delete this asset?")) return;
    try {
      const res = await fetch(`/api/admin/files/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { fetchUploadedFiles(); fetchDashboardData(); }
    } catch {}
  };

  const handleViewFile = async (file: UploadedFile) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/files/${file.id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to fetch preview");
      const data = await res.json();
      setPreviewData(data.preview || null);
      setPreviewColumns(data.columns || []);
      setPreviewTableName(data.tableName || file.filename);
      setPreviewDescription(data.description || null);
      setPreviewContent(data.content || null);
      setPreviewHasDownload(data.hasDownload === true);
      setPreviewFileId(file.id);
    } catch (e) { console.error("Failed to view file", e); }
  };

  // ── Auth ──
  const handleLogin = async (e?: React.FormEvent, customCreds?: { email: string; role: string }) => {
    if (e) e.preventDefault();
    setIsAuthLoading(true);
    setDashboardError(null);
    const loginEmail = customCreds ? customCreds.email : email;
    const loginPassword = customCreds ? "demopassword" : password;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Login failed"); }
      const data = await res.json();
      localStorage.setItem("agent_token", data.token);
      localStorage.setItem("agent_user", JSON.stringify(data.user));
      setToken(data.token); setUser(data.user); setIsLoggedIn(true);
      setThreadId(`thread_${Date.now()}`);
      setSalesUpdateSuccess(null);
      setMessages([{ id: "welcome", sender: "agent", text: "Сайн уу? Би **Шинжээч.ai** — таны өгөгдлийн шинжилгээний туслах. Надаас дата шинжилгээ, forecast, dashboard, эсвэл ерөнхий асуулт асууж болно.", timestamp: new Date(), agentName: "Шинжээч.ai" }]);
    } catch (e: unknown) { alert(e instanceof Error ? e.message : "Connection to API Server failed."); }
    finally { setIsAuthLoading(false); }
  };

  // ── Chat ──
  const handleSendMessage = async (e?: React.FormEvent, customInput?: string) => {
    if (e) e.preventDefault();
    const query = customInput || input;
    if (!query.trim() || isChatLoading || !token) return;
    if (!threadId) setThreadId(`thread_${Date.now()}`);
    if (!customInput) setInput("");
    const userMsg: Message = { id: `user_${Date.now()}`, sender: "user", text: query, timestamp: new Date() };
    setMessages(p => [...p, userMsg]);
    setIsChatLoading(true);
    setLastAgentResponded(null);
    setActiveRoutingState("routing");
    const agentMsgId = `agent_${Date.now()}`;
    setMessages(p => [...p, { id: agentMsgId, sender: "agent", text: "", timestamp: new Date(), agentName: "Шинжээч.ai" }]);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      if (streamEnabled) {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message: query, threadId, visualRequest: isGraphicModeEnabled }),
          signal: controller.signal,
        });
        if (!response.ok) { const err = await response.json(); throw new Error(err.error || "Failed to initiate agent stream"); }
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error("Response body is not readable");
        let buffer = "", fullResponse = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.trim().startsWith("data: ")) {
              const jsonStr = line.replace("data: ", "").trim();
              try {
                const data = JSON.parse(jsonStr);
                if (data.type === "delta") {
                  fullResponse += data.chunk;
                  let detectedAgent = "Шинжээч.ai";
                  let nodeState: typeof activeRoutingState = "routing";
                  if (fullResponse.includes("(Finance Agent)")) { detectedAgent = "Finance Agent"; nodeState = "finance"; }
                  else if (fullResponse.includes("(Tech Agent)")) { detectedAgent = "Tech Agent"; nodeState = "tech"; }
                  else if (fullResponse.includes("Security Alert")) { detectedAgent = "Security Manager"; nodeState = "idle"; }
                  setActiveRoutingState(nodeState);
                  setLastAgentResponded(detectedAgent);
                  setLastAgentType(detectedAgent);
                  setMessages(p => p.map(m => m.id === agentMsgId ? { ...m, text: fullResponse, agentName: detectedAgent } : m));
                } else if (data.type === "done") { setActiveRoutingState("done"); fetchDashboardData(); }
                else if (data.type === "error") throw new Error(data.error || "Streaming error occurred");
              } catch {}
            }
          }
        }
      } else {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message: query, threadId, visualRequest: isGraphicModeEnabled }),
          signal: controller.signal,
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed to get agent response"); }
        await res.json();
        setMessages(p => p.map(m => m.id === agentMsgId ? { ...m, text: "Execution complete.", agentName: "Agent System" } : m));
        setActiveRoutingState("done"); fetchDashboardData();
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setActiveRoutingState("idle");
        setMessages(p => { const last = p[p.length - 1]; return last && last.sender === "agent" ? p.map(m => m.id === last.id ? { ...m, text: m.text ? m.text + "\n\n*Хүсэлтийг цуцаллаа.*" : "*Хүсэлтийг цуцаллаа.*" } : m) : p; });
        return;
      }
      const errorMessage = e instanceof Error ? e.message : "An error occurred.";
      setActiveRoutingState("idle");
      setMessages(p => p.map(m => m.id === agentMsgId ? { ...m, text: errorMessage, agentName: "System Error Handler", isError: true } : m));
    } finally { setIsChatLoading(false); abortControllerRef.current = null; }
  };

  const handleCancelMessage = () => { abortControllerRef.current?.abort(); };

  // ── Feedback ──
  const handleFeedback = async (msgId: string, rating: 'positive' | 'negative') => {
    if (!token || feedbackState[msgId]) return;
    setFeedbackState(p => ({ ...p, [msgId]: rating }));
    const msgIndex = messages.findIndex(m => m.id === msgId);
    const agentMsg = messages[msgIndex];
    const userMsg = msgIndex > 0 ? messages.slice(0, msgIndex).reverse().find(m => m.sender === 'user') : null;
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: userMsg?.text || agentMsg?.text || "", response: agentMsg?.text || "", rating, threadId }),
      });
      if (!res.ok) setFeedbackState(p => ({ ...p, [msgId]: null }));
      const icon = rating === 'positive' ? '✓' : '✗';
      setFeedbackSentMsgs(p => ({ ...p, [msgId]: icon }));
      setTimeout(() => setFeedbackSentMsgs(p => { const n = { ...p }; delete n[msgId]; return n; }), 2000);
    } catch { setFeedbackState(p => ({ ...p, [msgId]: null })); }
  };

  // ── Admin: Update KPI target ──
  const handleUpdateKpiTarget = async () => {
    if (newTargetValue === undefined || isNaN(newTargetValue) || isUpdatingTarget || !token) return;
    setIsUpdatingTarget(true); setSalesUpdateSuccess(null);
    try {
      const res = await fetch(`/api/kpi/${adjustMetric}/target`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target: newTargetValue }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Update failed"); }
      setSalesUpdateSuccess("Target updated."); fetchDashboardData();
    } catch (e: unknown) { setSalesUpdateSuccess(`Error: ${e instanceof Error ? e.message : e}`); }
    finally { setIsUpdatingTarget(false); }
  };

  // ── Upload: CSV ──
  const handleUploadCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile || !tableNameInput.trim() || !tableDescInput.trim() || isUploadingCsv || !token) return;
    setIsUploadingCsv(true); setCsvUploadMessage(null);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvContent = event.target?.result as string;
      try {
        const res = await fetch("/api/admin/upload-csv", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ filename: csvFile.name, csvContent, tableName: tableNameInput, description: tableDescInput }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        setCsvUploadMessage(`Success: Table '${tableNameInput}' uploaded!`);
        if (data.preview) { setPreviewData(data.preview); setPreviewColumns(data.columns || []); setPreviewTableName(tableNameInput); setPreviewDescription(null); setPreviewContent(null); setPreviewHasDownload(false); setPreviewFileId(null); }
        setCsvFile(null); setTableNameInput(""); setTableDescInput("");
        fetchDashboardData(); fetchUploadedFiles();
      } catch (err: unknown) { setCsvUploadMessage(`Error: ${err instanceof Error ? err.message : err}`); }
      finally { setIsUploadingCsv(false); }
    };
    reader.onerror = () => { setCsvUploadMessage("Error reading file."); setIsUploadingCsv(false); };
    reader.readAsText(csvFile);
  };

  // ── Upload: Excel ──
  const handleUploadExcel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!excelFile || !excelTableNameInput.trim() || !excelDescInput.trim() || isUploadingExcel || !token) return;
    setIsUploadingExcel(true); setExcelUploadMessage(null);
    const formData = new FormData();
    formData.append("file", excelFile); formData.append("tableName", excelTableNameInput); formData.append("description", excelDescInput);
    try {
      const res = await fetch("/api/admin/upload-excel", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setExcelUploadMessage(`Success: Table '${excelTableNameInput}' imported!`);
      if (data.preview) { setPreviewData(data.preview); setPreviewColumns(data.columns || []); setPreviewTableName(excelTableNameInput); setPreviewDescription(null); setPreviewContent(null); setPreviewHasDownload(false); setPreviewFileId(null); }
      setExcelFile(null); setExcelTableNameInput(""); setExcelDescInput("");
      fetchDashboardData(); fetchUploadedFiles();
    } catch (err: unknown) { setExcelUploadMessage(`Error: ${err instanceof Error ? err.message : err}`); }
    finally { setIsUploadingExcel(false); }
  };

  // ── Upload: Document ──
  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFile || !docDescInput.trim() || isUploadingDoc || !token) return;
    setIsUploadingDoc(true); setDocUploadMessage(null);
    const formData = new FormData();
    formData.append("file", docFile); formData.append("description", docDescInput); formData.append("category", "manual"); formData.append("department", "general");
    try {
      const res = await fetch("/api/admin/upload-doc", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setDocUploadMessage(`Success: Document '${docFile.name}' indexed!`);
      setDocFile(null); setDocDescInput(""); fetchUploadedFiles();
    } catch (err: unknown) { setDocUploadMessage(`Error: ${err instanceof Error ? err.message : err}`); }
    finally { setIsUploadingDoc(false); }
  };

  // ── Close preview ──
  const closePreview = () => {
    setPreviewData(null); setPreviewDescription(null); setPreviewContent(null); setPreviewHasDownload(false); setPreviewFileId(null);
  };

  // ── Render ──
  const hasDataset = uploadedFiles.length > 0;

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground/80 font-sans antialiased text-xs flex flex-col transition-colors duration-200">
      <Header serverStatus={serverStatus} isLoggedIn={isLoggedIn} user={user} theme={theme}
        onToggleTheme={toggleTheme} onLogout={handleLogout}
        activeTab={activeTab} onTabChange={setActiveTab}
 />

      {!isLoggedIn ? (
        <LoginForm email={email} password={password} isAuthLoading={isAuthLoading}
          onEmailChange={setEmail} onPasswordChange={setPassword} onLogin={handleLogin} />
      ) : (
        <div className="relative flex-1 flex flex-col min-h-0">
          {activeTab === "ask" && (
            <main key="tab-ask" className="flex-1 flex overflow-hidden min-h-0 animate-fade-in-up">
              <section className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background relative">
                {/* ROUTING INDICATOR */}
                <div className="border-b border-border py-2.5 px-6 flex items-center justify-between bg-sidebar/50 transition-colors duration-200">
                  <div className="flex items-center gap-1.5 text-foreground/50 text-[10px] uppercase font-bold tracking-wider">
                    <span className={`w-1.5 h-1.5 rounded-full ${activeRoutingState !== "idle" && activeRoutingState !== "done" ? "bg-foreground animate-pulse" : "bg-foreground/30"}`} />
                    Шинжилгээний замнал
                  </div>
                  <div className="flex gap-4 items-center font-mono text-[9px]">
                    <span className={`${activeRoutingState === "routing" ? "text-foreground font-bold" : "text-foreground/40"}`}>Router</span>
                    <span className="text-foreground/30">→</span>
                    <span className={`${activeRoutingState === "finance" ? "text-foreground font-bold" : "text-foreground/40"}`}>FinanceAgent</span>
                    <span className="text-foreground/30">/</span>
                    <span className={`${activeRoutingState === "tech" ? "text-foreground font-bold" : "text-foreground/40"}`}>TechAgent</span>
                  </div>
                </div>

                {/* CHAT MESSAGES */}
                <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-6 flex flex-col justify-start">
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center my-auto gap-6">
                      <div className="text-center text-foreground/40">
                        <p className="font-semibold">Шинжилгээний хэлхээ идэвхтэй.</p>
                        <p className="text-[10px] mt-1">Доорх саналуудаас сонгох эсвэл өөрөө асуултаа бичнэ үү.</p>
                      </div>
                      <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                        {SUGGESTIONS_INITIAL.map((s, i) => (
                          <button key={i} onClick={() => handleSendMessage(undefined, s.query)}
                            className="px-3 py-1.5 text-xs bg-sidebar border border-border rounded hover:bg-foreground/5 hover:border-foreground/30 text-foreground/70 transition-all cursor-pointer animate-fade-in-up inline-flex items-center gap-1.5"
                            style={{ animationDelay: `${i * 50}ms` }}>
                            {s.icon}<span>{s.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((msg) => (
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
                              {msg.text && !isChatLoading && (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <button onClick={() => handleFeedback(msg.id, 'positive')}
                                    className={`text-[10px] px-1.5 py-0.5 rounded transition-all cursor-pointer ${feedbackState[msg.id] === 'positive' ? 'text-emerald-500 bg-emerald-500/10 border border-emerald-500/30' : 'text-foreground/40 hover:text-emerald-500 hover:bg-emerald-500/5 border border-transparent'}`}
                                    title="Сайн хариуллаа" disabled={!!feedbackState[msg.id]}>
                                    <ThumbsUp className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => handleFeedback(msg.id, 'negative')}
                                    className={`text-[10px] px-1.5 py-0.5 rounded transition-all cursor-pointer ${feedbackState[msg.id] === 'negative' ? 'text-red-500 bg-red-500/10 border border-red-500/30' : 'text-foreground/40 hover:text-red-500 hover:bg-red-500/5 border border-transparent'}`}
                                    title="Буруу хариуллаа" disabled={!!feedbackState[msg.id]}>
                                    <ThumbsDown className="w-3 h-3" />
                                  </button>
                                  {feedbackSentMsgs[msg.id] && feedbackState[msg.id] && <span className="text-[9px] text-foreground/50 ml-1">{feedbackSentMsgs[msg.id]}</span>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  {messages.length > 0 && lastAgentType && FOLLOW_UP_SUGGESTIONS[lastAgentType] && !isChatLoading && (
                    <div className="flex flex-wrap gap-2 justify-start max-w-2xl pt-2">
                      {FOLLOW_UP_SUGGESTIONS[lastAgentType].map((s, i) => (
                        <button key={i} onClick={() => handleSendMessage(undefined, s.query)}
                          className="px-2.5 py-1 text-[10px] bg-sidebar border border-border rounded hover:bg-foreground/5 hover:border-foreground/30 text-foreground/50 transition-all cursor-pointer animate-fade-in-up"
                          style={{ animationDelay: `${i * 50}ms` }}>{s.label}</button>
                      ))}
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <ChatInput input={input} isChatLoading={isChatLoading} streamEnabled={streamEnabled}
                  isGraphicModeEnabled={isGraphicModeEnabled} threadId={threadId}
                  onInputChange={setInput} onStreamEnabledChange={setStreamEnabled} onGraphicModeToggle={() => setIsGraphicModeEnabled(!isGraphicModeEnabled)}
                  onSubmit={handleSendMessage} onCancel={handleCancelMessage} />

              </section>
            </main>
          )}

          {activeTab === "dashboard" && (
            <main key="tab-dashboard" className="flex-1 flex overflow-hidden min-h-0 relative animate-fade-in-up">
              {/* Mobile sidebar overlay */}
              {sidebarOpen && (
                <div className="md:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setSidebarOpen(false)} />
              )}

              {/* SIDEBAR - only AdminPanel */}
              <section className={`shrink-0 border-r border-border bg-sidebar p-4 flex-col overflow-y-auto scrollbar-hide space-y-4 transition-all duration-200 md:w-[280px] md:flex md:relative ${
                sidebarOpen
                  ? "fixed inset-y-0 left-0 z-50 w-[280px] shadow-xl flex"
                  : "hidden"
              } md:inset-auto md:z-auto md:shadow-none`}>
                <div className="flex items-center justify-between md:hidden">
                  <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider">Удирдлага</span>
                  <button onClick={() => setSidebarOpen(false)} className="text-foreground/50 hover:text-foreground text-xs p-1 cursor-pointer">✕</button>
                </div>
                <AdminPanel user={user}
                  adjustMetric={adjustMetric} newTargetValue={newTargetValue} isUpdatingTarget={isUpdatingTarget} salesUpdateSuccess={salesUpdateSuccess}
                  onAdjustMetricChange={setAdjustMetric} onNewTargetValueChange={setNewTargetValue} onUpdateKpiTarget={handleUpdateKpiTarget}
                  csvFile={csvFile} tableNameInput={tableNameInput} tableDescInput={tableDescInput}
                  isUploadingCsv={isUploadingCsv} csvUploadMessage={csvUploadMessage}
                  onCsvFileChange={setCsvFile} onTableNameInputChange={setTableNameInput} onTableDescInputChange={setTableDescInput} onUploadCsv={handleUploadCsv}
                  excelFile={excelFile} excelTableNameInput={excelTableNameInput} excelDescInput={excelDescInput}
                  isUploadingExcel={isUploadingExcel} excelUploadMessage={excelUploadMessage}
                  onExcelFileChange={setExcelFile} onExcelTableNameInputChange={setExcelTableNameInput} onExcelDescInputChange={setExcelDescInput} onUploadExcel={handleUploadExcel}
                  docFile={docFile} docDescInput={docDescInput} isUploadingDoc={isUploadingDoc} docUploadMessage={docUploadMessage}
                  onDocFileChange={setDocFile} onDocDescInputChange={setDocDescInput} onUploadDoc={handleUploadDoc}
                  uploadedFiles={uploadedFiles} onViewFile={handleViewFile} onDeleteFile={handleDeleteFile} />
              </section>

              {/* DASHBOARD CONTENT */}
              <section className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-background p-4 md:p-6">
                {!hasDataset ? (
                  <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                    <LayoutDashboard className="w-12 h-12 text-foreground/20" />
                    <div>
                      <p className="text-sm font-semibold text-foreground/60">Dashboard хоосон байна</p>
                      <p className="text-[10px] text-foreground/40 mt-1">Dashboard харахын тулд эхлээд зүүн талын самбараар дата оруулна уу.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Mobile sidebar toggle */}
                    <div className="flex items-center gap-2 md:hidden">
                      <button onClick={() => setSidebarOpen(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-border rounded bg-sidebar text-foreground/60 hover:text-foreground transition-colors cursor-pointer">
                        Удирдлага
                      </button>
                    </div>

                    {/* PERIOD SELECTOR */}
                    <div className="flex items-center gap-2 animate-fade-in-up" style={{ animationDelay: "0ms" }}>
                      <span className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">Хугацаа:</span>
                      <div className="flex items-center border border-border rounded overflow-hidden text-[10px] font-bold">
                        {(["7d", "1m", "3m", "6m", "12m", "all"] as Period[]).map((p) => (
                          <button key={p} onClick={() => setPeriod(p)}
                            className={`px-2 py-1 uppercase tracking-wider transition-colors cursor-pointer ${period === p ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground"}`}>
                            {p === "all" ? "Бүгд" : p}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* KPI GRID */}
                    <div className="animate-fade-in-up" style={{ animationDelay: "50ms" }}>
                      <KpiGrid salesKpi={salesKpi} usersKpi={usersKpi} churnKpi={churnKpi} computedMetrics={computedMetrics} salesHistory={salesHistory} isLoading={isDashboardLoading} />
                    </div>

                    {/* CHARTS ROW */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-in-up" style={{ animationDelay: "150ms" }}>
                      <div className="border border-border/80 rounded-xl p-4 bg-card min-h-[200px]">
                        <p className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-3">Борлуулалтын график</p>
                        {salesHistory.length > 0 ? (
                          <ResponsiveContainer width="100%" height={160}>
                            <LineChart data={salesHistory}>
                              <XAxis dataKey="month" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                              <Tooltip {...chartTheme.tooltip} />
                              <Line type="monotone" dataKey="revenue" stroke={chartTheme.colors.semantic.line} strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="flex items-center justify-center h-[160px] text-[10px] text-foreground/30">Өгөгдөл байхгүй</div>
                        )}
                      </div>
                      <div className="border border-border/80 rounded-xl p-4 bg-card min-h-[200px]">
                        <p className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-3">Категорийн график</p>
                        {computedMetrics && computedMetrics.topCategory ? (
                          <ResponsiveContainer width="100%" height={160}>
                            <BarChart data={[{ name: computedMetrics.topCategory, value: computedMetrics.topCategoryValue }]}>
                              <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                              <Tooltip {...chartTheme.tooltip} />
                              <Bar dataKey="value" fill={chartTheme.colors.semantic.bar} radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="flex items-center justify-center h-[160px] text-[10px] text-foreground/30">Өгөгдөл байхгүй</div>
                        )}
                      </div>
                    </div>

                    {/* TABLE */}
                    <div className="border border-border/80 rounded-xl p-4 bg-card animate-fade-in-up" style={{ animationDelay: "250ms" }}>
                      <p className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-3">Борлуулалтын дэлгэрэнгүй</p>
                      {salesHistory.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="border-b border-border/60 text-foreground/50">
                                <th className="text-left py-1.5 pr-3 font-semibold">Сар</th>
                                <th className="text-right py-1.5 pr-3 font-semibold">Орлого</th>
                                <th className="text-right py-1.5 font-semibold">Өөрчлөлт</th>
                              </tr>
                            </thead>
                            <tbody>
                              {salesHistory.map((row, i) => {
                                const prev = i > 0 ? salesHistory[i - 1].revenue : row.revenue;
                                const change = prev > 0 ? ((row.revenue - prev) / prev * 100) : 0;
                                return (
                                  <tr key={row.month} className="border-b border-border/30 last:border-0">
                                    <td className="py-1.5 pr-3 text-foreground/80">{row.month}</td>
                                    <td className="py-1.5 pr-3 text-right text-foreground/80">{row.revenue.toLocaleString()}</td>
                                    <td className={`py-1.5 text-right ${i === 0 ? "text-foreground/40" : change >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                      {i > 0 ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-[100px] text-[10px] text-foreground/30">Өгөгдөл байхгүй</div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </main>
          )}

          {activeTab === "report" && (
            <main key="tab-report" className="flex-1 flex overflow-hidden min-h-0 animate-fade-in-up">
              <ReportView token={token!} />
            </main>
          )}

          <PreviewDrawer previewData={previewData} previewColumns={previewColumns} previewTableName={previewTableName}
            previewDescription={previewDescription} previewContent={previewContent} previewHasDownload={previewHasDownload} previewFileId={previewFileId}
            onClose={closePreview} />
        </div>
      )}
    </div>
  );
}
