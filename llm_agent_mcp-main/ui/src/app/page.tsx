"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  LogOut,
  Activity,
  BarChart2,
  Trash2,
  FileText,
  Sun,
  Moon,
  Square,
  ThumbsUp,
  ThumbsDown,
  PieChart as PieChartIcon,
  TrendingUp,
  LayoutDashboard,
  Upload,
} from "lucide-react";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, Legend } from "recharts";

interface Message {
  id: string;
  sender: "user" | "agent";
  text: string;
  timestamp: Date;
  agentName?: string;
  isError?: boolean;
}

const DEFAULT_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6"];

const sanitizeVisualJson = (str: string): string => {
  let s = str.trim();
  if (!s) return s;
  try { JSON.parse(s); return s; } catch { /* try fixing common LLM issues */ }
  s = s.replace(/,\s*([\]}])/g, "$1");
  s = s.replace(/([{,]\s*)(\w[\w\d_]*)(\s*:)/g, "$1\"$2\"$3");
  s = s.replace(/'/g, '"');
  try { JSON.parse(s); return s; } catch {}
  return s;
};

const VisualMessage = ({ visualJson }: { visualJson: string }) => {
  const sanitizedJson = sanitizeVisualJson(visualJson);

  let data: { title?: string; type?: string; data?: Record<string, unknown>[]; config?: Record<string, unknown> };
  try {
    data = JSON.parse(sanitizedJson);
  } catch (e) {
    console.error("Visual JSON Parse Error:", e);
    return <div className="text-[9px] text-red-500">Failed to render graphic: {String(e)}</div>;
  }

  if (!data.data || !Array.isArray(data.data)) {
    return <div className="text-[9px] text-red-500">Invalid data format</div>;
  }

  const config = data.config || {};
  const colors = (config.colors as string[]) || DEFAULT_COLORS;
  const series = config.series as string[] | undefined;
  const stacked = config.stacked === true;

  const renderMultiSeries = (ChartComponent: any, DataComponent: any, extraProps?: Record<string, unknown>) => {
    const s = series || ["value"];
    return (
      <ChartComponent data={data.data} layout={extraProps?.layout || undefined}>
        {extraProps?.layout === "vertical" ? null : <XAxis dataKey="label" stroke="#888888" fontSize={9} />}
        {extraProps?.layout === "vertical" ? <YAxis dataKey="label" type="category" stroke="#888888" fontSize={9} /> : <YAxis stroke="#888888" fontSize={9} />}
        {extraProps?.layout === "vertical" ? <XAxis type="number" stroke="#888888" fontSize={9} /> : null}
        <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
        {s.length > 1 && <Legend wrapperStyle={{ fontSize: "9px" }} />}
        {s.map((key, i) => (
          <DataComponent key={key} type="monotone" dataKey={key} fill={colors[i % colors.length]} stroke={colors[i % colors.length]} stackId={stacked ? "stack" : undefined} />
        ))}
      </ChartComponent>
    );
  };

  return (
    <div className="bg-sidebar border border-border rounded-lg p-4 mt-2 max-w-lg transition-colors duration-200">
      <h4 className="text-[10px] font-bold text-foreground/60 uppercase mb-3">{data.title}</h4>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {data.type === "bar" ? (
            stacked ? renderMultiSeries(BarChart, Bar) : series && series.length > 1 ? renderMultiSeries(BarChart, Bar) : (
              <BarChart data={data.data}>
                <XAxis dataKey="label" stroke="#888888" fontSize={9} />
                <YAxis stroke="#888888" fontSize={9} />
                <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
                <Bar dataKey="value" fill={colors[0]} />
              </BarChart>
            )
          ) : data.type === "horizontal_bar" ? (
            series && series.length > 1 ? renderMultiSeries(BarChart, Bar, { layout: "vertical" }) : (
              <BarChart data={data.data} layout="vertical">
                <XAxis type="number" stroke="#888888" fontSize={9} />
                <YAxis dataKey="label" type="category" stroke="#888888" fontSize={9} width={80} />
                <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
                <Bar dataKey="value" fill={colors[0]} />
              </BarChart>
            )
          ) : data.type === "line" ? (
            series && series.length > 1 ? renderMultiSeries(LineChart, Line) : (
              <LineChart data={data.data}>
                <XAxis dataKey="label" stroke="#888888" fontSize={9} />
                <YAxis stroke="#888888" fontSize={9} />
                <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
                <Line type="monotone" dataKey="value" stroke={colors[0]} />
              </LineChart>
            )
          ) : data.type === "area" ? (
            series && series.length > 1 ? renderMultiSeries(AreaChart, Area) : (
              <AreaChart data={data.data}>
                <XAxis dataKey="label" stroke="#888888" fontSize={9} />
                <YAxis stroke="#888888" fontSize={9} />
                <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
                <Area type="monotone" dataKey="value" fill={colors[0]} stroke={colors[0]} fillOpacity={0.3} />
              </AreaChart>
            )
          ) : data.type === "pie" ? (
            <PieChart>
              <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
              <Pie data={data.data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={70} label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""}: ${value ?? 0}`}>
                {data.data.map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : null}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const DashboardWidget = ({ widget }: { widget: any }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(timer);
  }, []);
  if (widget.type === "kpi") {
    const val = widget.value != null ? Number(widget.value) : null;
    const isLarge = val != null && val >= 10000;
    return (
      <div className="bg-gradient-to-br from-background to-sidebar border border-border/80 rounded-lg p-3 flex flex-col justify-center shadow-sm hover:shadow-md transition-shadow duration-150">
        <div className="text-[9px] text-foreground/50 uppercase tracking-wider font-semibold">{widget.title}</div>
        <div className={`${isLarge ? "text-2xl" : "text-xl"} font-bold text-foreground mt-1 tracking-tight`}>
          {val != null ? val.toLocaleString() : "—"}
          {widget.unit && <span className="text-[10px] text-foreground/50 ml-1 font-normal">{widget.unit}</span>}
        </div>
      </div>
    );
  }

  if (!widget.data || !Array.isArray(widget.data) || widget.data.length === 0) {
    return (
      <div className="bg-gradient-to-br from-background to-sidebar border border-border/80 rounded-lg p-3 shadow-sm">
        <div className="text-[9px] font-bold text-foreground/50 uppercase mb-2 tracking-wider">{widget.title}</div>
        <div className="text-[9px] text-foreground/40">{widget.error || "No data"}</div>
      </div>
    );
  }

  const colors = DEFAULT_COLORS;

  const renderChart = () => {
    switch (widget.type) {
      case "bar":
        return (
          <BarChart data={widget.data}>
            <XAxis dataKey="label" stroke="#888888" fontSize={9} />
            <YAxis stroke="#888888" fontSize={9} />
            <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
            <Bar dataKey="value" fill={colors[0]} />
          </BarChart>
        );
      case "horizontal_bar":
        return (
          <BarChart data={widget.data} layout="vertical">
            <XAxis type="number" stroke="#888888" fontSize={9} />
            <YAxis dataKey="label" type="category" stroke="#888888" fontSize={9} width={80} />
            <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
            <Bar dataKey="value" fill={colors[0]} />
          </BarChart>
        );
      case "line":
        return (
          <LineChart data={widget.data}>
            <XAxis dataKey="label" stroke="#888888" fontSize={9} />
            <YAxis stroke="#888888" fontSize={9} />
            <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
            <Line type="monotone" dataKey="value" stroke={colors[0]} />
          </LineChart>
        );
      case "area":
        return (
          <AreaChart data={widget.data}>
            <XAxis dataKey="label" stroke="#888888" fontSize={9} />
            <YAxis stroke="#888888" fontSize={9} />
            <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
            <Area type="monotone" dataKey="value" fill={colors[0]} stroke={colors[0]} fillOpacity={0.3} />
          </AreaChart>
        );
      case "pie":
        return (
          <PieChart>
            <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
            <Pie data={widget.data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={60} label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""}: ${value ?? 0}`}>
              {widget.data.map((_: any, i: number) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
          </PieChart>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-gradient-to-br from-background to-sidebar border border-border/80 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow duration-150" ref={chartRef}>
      <h5 className="text-[9px] font-bold text-foreground/50 uppercase mb-2 tracking-wider">{widget.title}</h5>
      <div className="h-40 w-full min-w-0" style={{ minHeight: "160px" }}>
        {ready && (
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

const DashboardMessage = ({ dashboardJson }: { dashboardJson: string }) => {
  let widgets: any[];
  try {
    widgets = JSON.parse(dashboardJson);
  } catch (e) {
    return <div className="text-[9px] text-red-500">Failed to render dashboard: {String(e)}</div>;
  }

  if (!Array.isArray(widgets) || widgets.length === 0) {
    return <div className="text-[9px] text-red-500">Invalid dashboard data</div>;
  }

  return (
    <div className="bg-gradient-to-br from-sidebar to-background border border-border/80 rounded-xl p-4 mt-2 max-w-3xl shadow-sm transition-colors duration-200">
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border/50">
        <div className="w-1.5 h-1.5 rounded-full bg-foreground/30" />
        <h4 className="text-[10px] font-bold text-foreground/50 uppercase tracking-widest">Dashboard</h4>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4">
        {widgets.filter((w: any) => w.type === "kpi").map((w: any, i: number) => (
          <DashboardWidget key={`kpi-${i}`} widget={w} />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {widgets.filter((w: any) => w.type !== "kpi").map((w: any, i: number) => (
          <DashboardWidget key={`chart-${i}`} widget={w} />
        ))}
      </div>
    </div>
  );
};

interface KpiData {
  name: string;
  current: number;
  target: number;
  unit: string;
  updatedAt: string;
}

interface SalesHistory {
  month: string;
  revenue: number;
}

interface UploadedFile {
  id: string;
  type: string;
  filename: string;
  description?: string;
}

interface ServerStatus {
  status: string;
  llm: {
    provider: string;
    model: string;
    isFree: boolean;
    rateLimit: string;
  };
  timestamp: string;
}

export default function Home() {
  // Authentication states
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [threadId, setThreadId] = useState<string>("");

  // Chat states
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [lastAgentType, setLastAgentType] = useState<string | null>(null);

  // Data Preview states
  const [previewData, setPreviewData] = useState<Record<string, unknown>[] | null>(null);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [previewTableName, setPreviewTableName] = useState("");
  const [previewDescription, setPreviewDescription] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewHasDownload, setPreviewHasDownload] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);

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

  // Dashboard / System metrics states
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [salesKpi, setSalesKpi] = useState<KpiData | null>(null);
  const [usersKpi, setUsersKpi] = useState<KpiData | null>(null);
  const [churnKpi, setChurnKpi] = useState<KpiData | null>(null);
  const [, setSalesHistory] = useState<SalesHistory[]>([]);
  const [, setDashboardError] = useState<string | null>(null);
  const [historyLimit] = useState<number>(5);

  // Visual graph animation states
  const [activeRoutingState, setActiveRoutingState] = useState<"idle" | "routing" | "finance" | "tech" | "done">("idle");
  const [, setLastAgentResponded] = useState<string | null>(null);

  // Admin Tools: Sandbox code runner state
  const [adminCode, setAdminCode] = useState<string>("import math\nprint(f'Calculated square root of 144 is: {math.sqrt(144)}')");
  const [adminCodeOutput, setAdminCodeOutput] = useState<string>("");
  const [isAdminRunningCode, setIsAdminRunningCode] = useState<boolean>(false);

  // Sales Tools: Adjust targets state
  const [adjustMetric, setAdjustMetric] = useState<"sales" | "users" | "churn_rate">("sales");
  const [newTargetValue, setNewTargetValue] = useState<number>(200000);
  const [isUpdatingTarget, setIsUpdatingTarget] = useState<boolean>(false);
  const [salesUpdateSuccess, setSalesUpdateSuccess] = useState<string | null>(null);

  // CSV Upload states
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [tableNameInput, setTableNameInput] = useState<string>("");
  const [tableDescInput, setTableDescInput] = useState<string>("");
  const [isUploadingCsv, setIsUploadingCsv] = useState<boolean>(false);
  const [csvUploadMessage, setCsvUploadMessage] = useState<string | null>(null);

  // Graphic Mode
  const [isGraphicModeEnabled, setIsGraphicModeEnabled] = useState<boolean>(false);

  // Feedback states
  const [feedbackState, setFeedbackState] = useState<Record<string, 'positive' | 'negative' | null>>({});
  const [feedbackSentMsgs, setFeedbackSentMsgs] = useState<Record<string, string>>({});

  // Document Upload states
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docDescInput, setDocDescInput] = useState<string>("");
  const [isUploadingDoc, setIsUploadingDoc] = useState<boolean>(false);
  const [docUploadMessage, setDocUploadMessage] = useState<string | null>(null);

  // File Manager states
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [, setIsFilesLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Theme state
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // Update theme class on HTML element
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
  };

  const handleLogout = () => {
    localStorage.removeItem("agent_token");
    localStorage.removeItem("agent_user");
    setToken(null);
    setUser(null);
    setIsLoggedIn(false);
    setMessages([]);
    setSalesKpi(null);
    setUsersKpi(null);
    setChurnKpi(null);
    setSalesHistory([]);
  };

  // Restore auth state from localStorage on client mount
  useEffect(() => {
    const storedToken = localStorage.getItem("agent_token");
    const storedUser = localStorage.getItem("agent_user");
    if (storedToken && storedUser) {
      setToken(storedToken); // eslint-disable-line react-hooks/set-state-in-effect
      setUser(JSON.parse(storedUser));
      setIsLoggedIn(true);
      setThreadId(`thread_${Date.now()}`);
    }
  }, []);

  // Restore theme from localStorage on client mount
  useEffect(() => {
    const storedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    if (storedTheme) {
      setTheme(storedTheme); // eslint-disable-line react-hooks/set-state-in-effect
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setTheme(prefersDark ? "dark" : "light");
    }
  }, []);

  const fetchServerStatus = async () => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const data = await res.json();
        setServerStatus(data);
      }
    } catch (e) {
      console.error("Failed to fetch server status", e);
    }
  };

  const fetchDashboardData = async () => {
    if (!token) return;
    try {
      setDashboardError(null);
      const headers = { Authorization: `Bearer ${token}` };

      const salesRes = await fetch("/api/kpi/sales", { headers });
      if (salesRes.ok) {
        const data = await salesRes.json();
        setSalesKpi(data);
      } else if (salesRes.status === 401) {
        handleLogout();
        return;
      }

      const usersRes = await fetch("/api/kpi/users", { headers });
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsersKpi(data);
      }

      const churnRes = await fetch("/api/kpi/churn_rate", { headers });
      if (churnRes.ok) {
        const data = await churnRes.json();
        setChurnKpi(data);
      }

      const historyRes = await fetch(`/api/kpi-history?limit=${historyLimit}`, { headers });
      if (historyRes.ok) {
        const data = await historyRes.json();
        setSalesHistory(data);
      }
    } catch (e: unknown) {
      setDashboardError("Could not retrieve KPI data. Ensure API server is running.");
      console.error("Dashboard fetch error", e);
    }
  };

  const fetchUploadedFiles = async () => {
    if (!token) return;
    setIsFilesLoading(true);
    try {
      const res = await fetch("/api/admin/files", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUploadedFiles(data);
      }
    } catch (e) {
      console.error("Failed to fetch uploaded files", e);
    } finally {
      setIsFilesLoading(false);
    }
  };

  // Fetch server status on mount
  useEffect(() => {
    fetchServerStatus(); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  // Fetch metrics when logged in or history limit changes
  useEffect(() => {
    if (isLoggedIn && token) {
      fetchDashboardData(); // eslint-disable-line react-hooks/set-state-in-effect
      fetchUploadedFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, token, historyLimit]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleDeleteFile = async (id: string) => {
    if (!token || !confirm("Are you sure you want to delete this asset?")) return;
    try {
      const res = await fetch(`/api/admin/files/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchUploadedFiles();
        fetchDashboardData();
      }
    } catch (e) {
      console.error("Failed to delete file", e);
    }
  };

  const handleViewFile = async (file: UploadedFile) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/files/${file.id}/preview`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch preview");
      const data = await res.json();
      setPreviewData(data.preview || null);
      setPreviewColumns(data.columns || []);
      setPreviewTableName(data.tableName || file.filename);
      setPreviewDescription(data.description || null);
      setPreviewContent(data.content || null);
      setPreviewHasDownload(data.hasDownload === true);
      setPreviewFileId(file.id);
    } catch (e) {
      console.error("Failed to view file", e);
    }
  };

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

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Login failed");
      }

      const data = await res.json();
      localStorage.setItem("agent_token", data.token);
      localStorage.setItem("agent_user", JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      setIsLoggedIn(true);
      setThreadId(`thread_${Date.now()}`);
      
      setAdminCodeOutput("");
      setSalesUpdateSuccess(null);

      setMessages([
        {
          id: "welcome",
          sender: "agent",
          text: `Сайн уу? Би **Шинжээч.ai** — таны өгөгдлийн шинжилгээний туслах. Надаас дата шинжилгээ, forecast, dashboard, эсвэл ерөнхий асуулт асууж болно.`,
          timestamp: new Date(),
          agentName: "Шинжээч.ai",
        },
      ]);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Connection to API Server failed.");
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent, customInput?: string) => {
    if (e) e.preventDefault();
    const query = customInput || input;
    if (!query.trim() || isChatLoading || !token) return;

    if (!threadId) {
      setThreadId(`thread_${Date.now()}`);
    }

    if (!customInput) setInput("");

    const userMsgId = `user_${Date.now()}`;
    const userMessage: Message = {
      id: userMsgId,
      sender: "user",
      text: query,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsChatLoading(true);
    setLastAgentResponded(null);

    setActiveRoutingState("routing");

    const agentMsgId = `agent_${Date.now()}`;
    const initialAgentMessage: Message = {
      id: agentMsgId,
      sender: "agent",
      text: "",
      timestamp: new Date(),
      agentName: "Шинжээч.ai",
    };
    setMessages((prev) => [...prev, initialAgentMessage]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      if (streamEnabled) {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: query, threadId, visualRequest: isGraphicModeEnabled }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Failed to initiate agent stream");
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error("Response body is not readable");

        let buffer = "";
        let fullResponse = "";

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

                  if (fullResponse.includes("(Finance Agent)")) {
                    detectedAgent = "Finance Agent";
                    nodeState = "finance";
                  } else if (fullResponse.includes("(Tech Agent)")) {
                    detectedAgent = "Tech Agent";
                    nodeState = "tech";
                  } else if (fullResponse.includes("Security Alert")) {
                    detectedAgent = "Security Manager";
                    nodeState = "idle";
                  }

                  setActiveRoutingState(nodeState);
                  setLastAgentResponded(detectedAgent);
                  setLastAgentType(detectedAgent);

                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === agentMsgId
                        ? {
                            ...msg,
                            text: fullResponse,
                            agentName: detectedAgent,
                          }
                        : msg
                    )
                  );
                } else if (data.type === "done") {
                  setActiveRoutingState("done");
                  fetchDashboardData();
                } else if (data.type === "error") {
                  throw new Error(data.error || "Streaming error occurred");
                }
              } catch (errJson) {
                console.error("Error parsing stream chunk", errJson);
              }
            }
          }
        }
      } else {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: query, threadId, visualRequest: isGraphicModeEnabled }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to get agent response");
        }

        await res.json();
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === agentMsgId
              ? {
                  ...msg,
                  text: "Execution complete.",
                  agentName: "Agent System",
                }
              : msg
          )
        );
        setActiveRoutingState("done");
        fetchDashboardData();
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        console.log("Request aborted by user.");
        setActiveRoutingState("idle");
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.sender === "agent") {
            return prev.map((msg) =>
              msg.id === lastMsg.id
                ? {
                    ...msg,
                    text: msg.text ? msg.text + " \n\n*Хүсэлтийг цуцаллаа.*" : "*Хүсэлтийг цуцаллаа.*",
                  }
                : msg
            );
          }
          return prev;
        });
        return;
      }
      const errorMessage = e instanceof Error ? e.message : "An error occurred while communicating with the agent system.";
      setActiveRoutingState("idle");
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === agentMsgId
            ? {
                ...msg,
                text: errorMessage,
                agentName: "System Error Handler",
                isError: true,
              }
            : msg
        )
      );
    } finally {
      setIsChatLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelMessage = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleFeedback = async (msgId: string, rating: 'positive' | 'negative') => {
    if (!token || feedbackState[msgId]) return;
    setFeedbackState(prev => ({ ...prev, [msgId]: rating }));
    const msgIndex = messages.findIndex(m => m.id === msgId);
    const agentMsg = messages[msgIndex];
    const userMsg = msgIndex > 0 ? messages.slice(0, msgIndex).reverse().find(m => m.sender === 'user') : null;
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: userMsg?.text || agentMsg?.text || "",
          response: agentMsg?.text || "",
          rating,
          threadId,
        }),
      });
      if (!res.ok) {
        setFeedbackState(prev => ({ ...prev, [msgId]: null }));
      }
      const icon = rating === 'positive' ? '✓' : '✗';
      setFeedbackSentMsgs(prev => ({ ...prev, [msgId]: icon }));
      setTimeout(() => setFeedbackSentMsgs(prev => {
        const next = { ...prev };
        delete next[msgId];
        return next;
      }), 2000);
    } catch {
      setFeedbackState(prev => ({ ...prev, [msgId]: null }));
    }
  };

  const handleRunAdminCode = async () => {
    if (!adminCode.trim() || isAdminRunningCode || !token) return;
    setIsAdminRunningCode(true);
    setAdminCodeOutput("Executing script in secure E2B MicroVM...");

    try {
      const res = await fetch("/api/admin/run-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: adminCode }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Execution failed");
      }

      const data = await res.json();
      setAdminCodeOutput(data.output || "Execution completed. No output.");
    } catch (e: unknown) {
      setAdminCodeOutput(`Error: ${e instanceof Error ? e.message : e}`);
    } finally {
      setIsAdminRunningCode(false);
    }
  };

  const handleUpdateKpiTarget = async () => {
    if (newTargetValue === undefined || isNaN(newTargetValue) || isUpdatingTarget || !token) return;
    setIsUpdatingTarget(true);
    setSalesUpdateSuccess(null);

    try {
      const res = await fetch(`/api/kpi/${adjustMetric}/target`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ target: newTargetValue }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Update failed");
      }

      setSalesUpdateSuccess("Target updated.");
      fetchDashboardData();
    } catch (e: unknown) {
      setSalesUpdateSuccess(`Error: ${e instanceof Error ? e.message : e}`);
    } finally {
      setIsUpdatingTarget(false);
    }
  };

  const handleUploadCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile || !tableNameInput.trim() || !tableDescInput.trim() || isUploadingCsv || !token) return;

    setIsUploadingCsv(true);
    setCsvUploadMessage(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvContent = event.target?.result as string;
      try {
        const res = await fetch("/api/admin/upload-csv", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            filename: csvFile.name,
            csvContent,
            tableName: tableNameInput,
            description: tableDescInput,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Upload failed");
        }

        setCsvUploadMessage(`Success: Table '${tableNameInput}' uploaded!`);
        if (data.preview) {
          setPreviewData(data.preview);
          setPreviewColumns(data.columns || []);
          setPreviewTableName(tableNameInput);
          setPreviewDescription(null);
          setPreviewContent(null);
          setPreviewHasDownload(false);
          setPreviewFileId(null);
        }
        setCsvFile(null);
        setTableNameInput("");
        setTableDescInput("");
        fetchDashboardData();
        fetchUploadedFiles();
      } catch (err: unknown) {
        setCsvUploadMessage(`Error: ${err instanceof Error ? err.message : err}`);
      } finally {
        setIsUploadingCsv(false);
      }
    };

    reader.onerror = () => {
      setCsvUploadMessage("Error reading file.");
      setIsUploadingCsv(false);
    };

    reader.readAsText(csvFile);
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFile || !docDescInput.trim() || isUploadingDoc || !token) return;

    setIsUploadingDoc(true);
    setDocUploadMessage(null);

    const formData = new FormData();
    formData.append("file", docFile);
    formData.append("description", docDescInput);
    formData.append("category", "manual");
    formData.append("department", "general");

    try {
      const res = await fetch("/api/admin/upload-doc", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setDocUploadMessage(`Success: Document '${docFile.name}' indexed!`);
      setDocFile(null);
      setDocDescInput("");
      fetchUploadedFiles();
    } catch (err: unknown) {
      setDocUploadMessage(`Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setIsUploadingDoc(false);
    }
  };

  const formatMessageText = (text: string) => {
    if (!text) return "";

    // Split by <visual> and <dashboard> tags while preserving tagged blocks.
    const tagPattern = new RegExp("(<(?:visual|dashboard)>[\\s\\S]*?<\\/(?:visual|dashboard)>)", "g");
    const parts = text.split(tagPattern);

    return parts.map((part, idx) => {
      if (part.startsWith("<visual>")) {
        const stripTag = new RegExp("<\\/?visual>", "g");
        const jsonContent = part.replace(stripTag, "");
        return <VisualMessage key={idx} visualJson={jsonContent} />;
      }
      if (part.startsWith("<dashboard>")) {
        const stripTag = new RegExp("<\\/?dashboard>", "g");
        const jsonContent = part.replace(stripTag, "");
        return <DashboardMessage key={idx} dashboardJson={jsonContent} />;
      }

      const lines = part.split("\n");
      return lines.map((line, lineIdx) => {
        // Strip out routing prefixes from output rendering to keep it clean
        if (line.startsWith("(Finance Agent)") || line.startsWith("(Tech Agent)")) {
          return null;
        }

        let content: React.ReactNode = line;
        const isBullet = line.startsWith("- ") || line.startsWith("* ");
        const cleanLine = isBullet ? line.substring(2) : line;

        const boldRegex = new RegExp("\\*\\*(.*?)\\*\\*", "g");
        const boldParts = [];
        let lastIndex = 0;
        let match;
        
        while ((match = boldRegex.exec(cleanLine)) !== null) {
          const textBefore = cleanLine.substring(lastIndex, match.index);
          const boldText = match[1];
          
          if (textBefore) boldParts.push(textBefore);
          boldParts.push(<strong key={match.index} className="font-semibold text-foreground">{boldText}</strong>);
          lastIndex = boldRegex.lastIndex;
        }
        
        const textAfter = cleanLine.substring(lastIndex);
        if (textAfter) boldParts.push(textAfter);

        content = boldParts.length > 0 ? boldParts : cleanLine;

        if (isBullet) {
          return (
            <li key={`${idx}-${lineIdx}`} className="ml-4 list-disc text-foreground/80 my-1">
              {content}
            </li>
          );
        }

        if (line.trim() === "") {
          return <div key={`${idx}-${lineIdx}`} className="h-2" />;
        }

        return (
          <p key={`${idx}-${lineIdx}`} className="text-foreground/80 leading-relaxed my-0.5">
            {content}
          </p>
        );
      });
    });
  };

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground/80 font-sans antialiased text-xs flex flex-col transition-colors duration-200">
      
      {/* HEADER */}
      <header className="border-b border-border bg-background px-6 py-3 flex items-center justify-between transition-colors duration-200">
        <div className="flex items-center gap-2">
          <span className="font-bold text-foreground text-sm tracking-tight">Шинжээч.ai</span>
          <span className="text-[10px] text-foreground/50 font-mono">v1.3</span>
        </div>

        <div className="flex items-center gap-4">
          {serverStatus && (
            <div className="flex items-center gap-1.5 text-[10px] text-foreground/50 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>{serverStatus.llm.model}</span>
            </div>
          )}

          {isLoggedIn && user && (
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-foreground/50 font-mono">
                {user.email}
              </span>
              <button
                onClick={handleLogout}
                className="p-1 text-foreground/50 hover:text-foreground transition-colors cursor-pointer"
                title="Log Out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={toggleTheme}
            className="p-1 text-foreground/50 hover:text-foreground transition-colors cursor-pointer flex items-center justify-center active:scale-95 duration-100"
            title={theme === "light" ? "Харанхуй горим" : "Гэрэлт горим"}
          >
            {theme === "light" ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* LOGIN VIEW */}
      {!isLoggedIn ? (
        <main className="flex-1 flex items-center justify-center p-4 bg-background transition-colors duration-200">
          <div className="w-full border border-border bg-card rounded-lg p-4 shadow-sm transition-colors duration-200 max-w-sm">
            <div className="text-center mb-3">
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Login Required</h2>
            </div>

            <form onSubmit={(e) => handleLogin(e)} className="space-y-2">
              <div>
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors"
                />
              </div>

              <div>
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={isAuthLoading}
                className="w-full bg-foreground text-background hover:opacity-90 font-bold py-1.5 rounded text-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {isAuthLoading ? "Loading..." : "Sign In"}
              </button>
            </form>
          </div>
        </main>
      ) : (
        /* MAIN DASHBOARD & CHAT VIEW */
        <main className="flex-1 flex overflow-hidden min-h-0">
          
          {/* LEFT SIDEBAR: KPI METRICS & CONTROLS */}
          <section className="w-full md:w-[320px] shrink-0 border-r border-border bg-sidebar p-5 flex flex-col overflow-y-auto scrollbar-hide space-y-6 md:flex hidden transition-colors duration-200">
            
            {/* KPI METRICS */}
            <div className="space-y-4">
              <div className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2">Metrics</div>
              
              {/* Sales Metric */}
              <div className="py-2.5 border-b border-border">
                <span className="text-foreground/60 block text-[10px] uppercase font-semibold">Sales Revenue</span>
                <div className="flex justify-between items-baseline mt-0.5">
                  <span className="text-sm font-extrabold text-foreground">
                    {salesKpi ? `$${salesKpi.current.toLocaleString()}` : "—"}
                  </span>
                  <span className="text-[10px] text-foreground/50 font-mono">
                    Target: {salesKpi ? `$${salesKpi.target.toLocaleString()}` : "—"}
                  </span>
                </div>
              </div>

              {/* Users Metric */}
              <div className="py-2.5 border-b border-border">
                <span className="text-foreground/60 block text-[10px] uppercase font-semibold">Active Users</span>
                <div className="flex justify-between items-baseline mt-0.5">
                  <span className="text-sm font-extrabold text-foreground">
                    {usersKpi ? usersKpi.current.toLocaleString() : "—"}
                  </span>
                  <span className="text-[10px] text-foreground/50 font-mono">
                    Goal: {usersKpi ? usersKpi.target : "—"}
                  </span>
                </div>
              </div>

              {/* Churn Metric */}
              <div className="py-2.5">
                <span className="text-foreground/60 block text-[10px] uppercase font-semibold">Churn Rate</span>
                <div className="flex justify-between items-baseline mt-0.5">
                  <span className={`text-sm font-extrabold ${churnKpi && churnKpi.current > churnKpi.target ? "text-red-500 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {churnKpi ? `${churnKpi.current}%` : "—"}
                  </span>
                  <span className="text-[10px] text-foreground/50 font-mono">
                    Limit: {churnKpi ? `${churnKpi.target}%` : "—"}
                  </span>
                </div>
              </div>
            </div>

            {user && (
              <div className="border-t border-border pt-5 space-y-4">
                
                {/* PYTHON CONSOLE */}
                <div className="space-y-2">
                  <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">Sandbox Code VM</span>
                  <textarea
                    value={adminCode}
                    onChange={(e) => setAdminCode(e.target.value)}
                    className="w-full h-20 bg-background border border-border rounded p-2 font-mono text-[10px] text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors"
                  />
                  <button
                    onClick={handleRunAdminCode}
                    disabled={isAdminRunningCode || !adminCode.trim()}
                    className="w-full py-1.5 bg-background border border-border hover:bg-foreground/5 text-foreground rounded text-[10px] font-bold cursor-pointer transition-colors duration-150"
                  >
                    {isAdminRunningCode ? "Executing..." : "Execute Python VM"}
                  </button>
                  {adminCodeOutput && (
                    <pre className="bg-background border border-border rounded p-2 font-mono text-[9px] text-foreground/70 overflow-x-auto max-h-24">
                      {adminCodeOutput}
                    </pre>
                  )}
                </div>

                {/* TARGET MANAGER */}
                <div className="space-y-2.5">
                  <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">Target Manager</span>
                  <div className="flex gap-2">
                    <select
                      value={adjustMetric}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAdjustMetric(e.target.value as "sales" | "users" | "churn_rate")}
                      className="flex-1 bg-background border border-border rounded px-2 py-1 text-[10px] text-foreground focus:outline-none focus:border-foreground/30"
                    >
                      <option value="sales">Sales</option>
                      <option value="users">Users</option>
                      <option value="churn_rate">Churn</option>
                    </select>
                    <input
                      type="number"
                      value={newTargetValue}
                      onChange={(e) => setNewTargetValue(Number(e.target.value))}
                      className="w-16 bg-background border border-border rounded px-2 py-1 text-center text-[10px] text-foreground focus:outline-none focus:border-foreground/30"
                    />
                  </div>
                  <button
                    onClick={handleUpdateKpiTarget}
                    disabled={isUpdatingTarget}
                    className="w-full py-1.5 bg-background border border-border hover:bg-foreground/5 text-foreground rounded text-[10px] font-bold cursor-pointer transition-colors duration-150"
                  >
                    Update Target
                  </button>
                  {salesUpdateSuccess && (
                    <p className="text-[9px] text-center text-emerald-600 dark:text-emerald-450">{salesUpdateSuccess}</p>
                  )}
                </div>

                {/* DATA UPLOADER */}
                <div className="border-t border-border pt-4 space-y-2">
                  <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">Upload Dataset (CSV)</span>
                  <form onSubmit={handleUploadCsv} className="space-y-2">
                    <input
                      type="text"
                      required
                      placeholder="Table name (e.g. branch_sales)"
                      value={tableNameInput}
                      onChange={(e) => setTableNameInput(e.target.value)}
                      className="w-full bg-background border border-border rounded p-1.5 text-[10px] text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Description of data..."
                      value={tableDescInput}
                      onChange={(e) => setTableDescInput(e.target.value)}
                      className="w-full bg-background border border-border rounded p-1.5 text-[10px] text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors"
                    />
                    <div className="relative border border-dashed border-border hover:border-foreground/30 rounded p-3 text-center transition-colors cursor-pointer bg-background/50 text-foreground">
                      <input
                        type="file"
                        accept=".csv"
                        required
                        onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <span className="text-[10px] text-foreground/60 block truncate">
                        {csvFile ? csvFile.name : "Select CSV file"}
                      </span>
                    </div>
                    <button
                      type="submit"
                      disabled={isUploadingCsv || !csvFile || !tableNameInput.trim() || !tableDescInput.trim()}
                      className="w-full py-1.5 bg-background border border-border hover:bg-foreground/5 text-foreground rounded text-[10px] font-bold cursor-pointer transition-colors disabled:opacity-50 duration-150"
                    >
                      {isUploadingCsv ? "Uploading..." : "Upload & Index"}
                    </button>
                  </form>
                  {csvUploadMessage && (
                    <p className="text-[9px] text-foreground/60 mt-1 max-w-full break-words">{csvUploadMessage}</p>
                  )}
                </div>

                {/* DOCUMENT UPLOADER (PDF/DOCX) */}
                <div className="border-t border-border pt-4 space-y-2">
                  <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">Upload Document (PDF/DOCX)</span>
                  <form onSubmit={handleUploadDoc} className="space-y-2">
                    <input
                      type="text"
                      required
                      placeholder="Brief description..."
                      value={docDescInput}
                      onChange={(e) => setDocDescInput(e.target.value)}
                      className="w-full bg-background border border-border rounded p-1.5 text-[10px] text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors"
                    />
                    <div className="relative border border-dashed border-border hover:border-foreground/30 rounded p-3 text-center transition-colors cursor-pointer bg-background/50 text-foreground">
                      <input
                        type="file"
                        accept=".pdf,.docx"
                        required
                        onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <span className="text-[10px] text-foreground/60 block truncate">
                        {docFile ? docFile.name : "Select PDF or Word file"}
                      </span>
                    </div>
                    <button
                      type="submit"
                      disabled={isUploadingDoc || !docFile || !docDescInput.trim()}
                      className="w-full py-1.5 bg-background border border-border hover:bg-foreground/5 text-foreground rounded text-[10px] font-bold cursor-pointer transition-colors disabled:opacity-50 duration-150"
                    >
                      {isUploadingDoc ? "Indexing..." : "Index Document"}
                    </button>
                  </form>
                  {docUploadMessage && (
                    <p className="text-[9px] text-foreground/60 mt-1 max-w-full break-words">{docUploadMessage}</p>
                  )}
                </div>

                {/* FILE MANAGER LIST */}
                <div className="border-t border-border pt-4 space-y-2">
                  <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">Uploaded Assets</span>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {uploadedFiles.length === 0 ? (
                      <p className="text-[9px] text-foreground/45 italic">No assets uploaded yet.</p>
                    ) : (
                      uploadedFiles.map((f, fi) => (
                        <div key={f.id} onClick={() => handleViewFile(f)} className="group flex items-center justify-between bg-background border border-border/80 hover:border-foreground/20 rounded px-2 py-1.5 transition-colors cursor-pointer animate-fade-in-up" style={{ animationDelay: `${fi * 40}ms` }}>
                          <div className="flex items-center gap-2 overflow-hidden">
                            {f.type === "dataset" ? <Activity className="w-3 h-3 text-foreground/60 shrink-0" /> : <FileText className="w-3 h-3 text-foreground/60 shrink-0" />}
                            <span className="text-[10px] text-foreground/70 truncate" title={f.description || f.filename}>
                              {f.filename.length > 15 ? f.filename.substring(0, 12) + "..." : f.filename}
                            </span>
                          </div>
                          <button
                            onClick={() => handleDeleteFile(f.id)}
                            className="text-foreground/45 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                            title="Delete Asset"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            )}
            </section>

          {/* RIGHT PANELS: VISUALIZER & CHAT */}
          <section className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background relative">
            
            {/* MINIMALIST ROUTING INDICATOR */}
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

            {/* CHAT MESSAGES THREAD */}
            <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-6 flex flex-col justify-start">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center my-auto gap-6">
                  <div className="text-center text-foreground/40">
                    <p className="font-semibold">Шинжилгээний хэлхээ идэвхтэй.</p>
                    <p className="text-[10px] mt-1">Доорх саналуудаас сонгох эсвэл өөрөө асуултаа бичнэ үү.</p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                    {SUGGESTIONS_INITIAL.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleSendMessage(undefined, s.query)}
                        className="px-3 py-1.5 text-xs bg-sidebar border border-border rounded hover:bg-foreground/5 hover:border-foreground/30 text-foreground/70 transition-all cursor-pointer animate-fade-in-up inline-flex items-center gap-1.5"
                        style={{ animationDelay: `${i * 50}ms` }}
                      >
                        {s.icon}
                        <span>{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                      className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"} animate-fade-in-up`}
                  >
                    <div className="max-w-2xl w-full flex flex-col">
                      {msg.sender === "user" ? (
                        <div className="bg-foreground text-background border border-foreground/10 rounded-2xl px-4 py-2.5 text-xs max-w-[80%] self-end shadow-sm transition-colors duration-200">
                          {msg.text}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1 border-l border-border pl-4 py-0.5 transition-colors duration-200">
                          {msg.agentName && (
                            <span className="text-[9px] text-foreground/50 font-bold uppercase tracking-wider">
                              {msg.agentName}
                            </span>
                          )}
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
                              <button
                                onClick={() => handleFeedback(msg.id, 'positive')}
                                className={`text-[10px] px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                                  feedbackState[msg.id] === 'positive'
                                    ? 'text-emerald-500 bg-emerald-500/10 border border-emerald-500/30'
                                    : 'text-foreground/40 hover:text-emerald-500 hover:bg-emerald-500/5 border border-transparent'
                                }`}
                                title="Сайн хариуллаа"
                                disabled={!!feedbackState[msg.id]}
                               >
                                 <ThumbsUp className="w-3 h-3" />
                               </button>
                               <button
                                 onClick={() => handleFeedback(msg.id, 'negative')}
                                 className={`text-[10px] px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                                   feedbackState[msg.id] === 'negative'
                                     ? 'text-red-500 bg-red-500/10 border border-red-500/30'
                                     : 'text-foreground/40 hover:text-red-500 hover:bg-red-500/5 border border-transparent'
                                 }`}
                                 title="Буруу хариуллаа"
                                 disabled={!!feedbackState[msg.id]}
                               >
                                 <ThumbsDown className="w-3 h-3" />
                               </button>
                              {feedbackSentMsgs[msg.id] && feedbackState[msg.id] && (
                                <span className="text-[9px] text-foreground/50 ml-1">{feedbackSentMsgs[msg.id]}</span>
                              )}
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
                    <button
                      key={i}
                      onClick={() => handleSendMessage(undefined, s.query)}
                      className="px-2.5 py-1 text-[10px] bg-sidebar border border-border rounded hover:bg-foreground/5 hover:border-foreground/30 text-foreground/50 transition-all cursor-pointer animate-fade-in-up"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* CHAT INPUT FORM */}
            <form onSubmit={handleSendMessage} className="p-6 border-t border-border bg-background space-y-2 transition-colors duration-200">
              <div className="flex justify-between items-center text-[10px] text-foreground/50 font-mono">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={streamEnabled}
                    onChange={(e) => setStreamEnabled(e.target.checked)}
                    className="rounded border-border bg-background text-foreground focus:ring-0 focus:ring-offset-0 w-3 h-3"
                  />
                  SSE Stream
                </label>
                <div>
                  ID: {threadId.substring(0, 10)}...
                </div>
              </div>

              <div className="flex gap-3 items-center max-w-3xl mx-auto w-full">
                <button
                  type="button"
                  onClick={() => setIsGraphicModeEnabled(!isGraphicModeEnabled)}
                  className={`p-2 rounded transition-all cursor-pointer border ${
                    isGraphicModeEnabled 
                      ? "bg-foreground text-background border-foreground" 
                      : "bg-sidebar border-border text-foreground/50 hover:text-foreground hover:border-foreground/30"
                  }`}
                  title={isGraphicModeEnabled ? "Graphic Mode ON" : "Graphic Mode OFF"}
                >
                  <BarChart2 className="w-3.5 h-3.5" />
                </button>
                <input
                  type="text"
                  placeholder="Шинжээч-ээс асуух..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isChatLoading}
                  className="flex-1 bg-sidebar border border-border rounded py-2 px-3 text-xs text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 text-[11px] disabled:opacity-50 transition-all duration-150"
                />
                {isChatLoading ? (
                  <button
                    type="button"
                    onClick={handleCancelMessage}
                    className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/20 hover:border-red-500/50 rounded font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95 duration-150"
                    title="Stop generation"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span className="text-xs font-semibold">Stop</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isChatLoading || !input.trim()}
                    className="p-2 bg-foreground text-background hover:opacity-90 rounded font-bold transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer flex items-center justify-center active:scale-95 duration-150"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </form>

            {/* DATA PREVIEW DRAWER */}
            {previewData !== null && (
              <div className="absolute right-0 top-0 bottom-0 w-[480px] border-l border-border bg-sidebar z-50 flex flex-col shadow-xl animate-slide-in-right">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider shrink-0">Preview</span>
                    <h3 className="text-xs font-bold text-foreground/80 truncate">{previewTableName}</h3>
                  </div>
                  <button
                    onClick={() => { setPreviewData(null); setPreviewDescription(null); setPreviewContent(null); setPreviewHasDownload(false); setPreviewFileId(null); }}
                    className="text-foreground/40 hover:text-foreground text-sm cursor-pointer leading-none p-1"
                    title="Close"
                  >✕</button>
                </div>
                {previewData.length > 0 ? (
                  <div className="flex-1 overflow-auto p-3 animate-scale-in">
                    <table className="w-full text-[10px] border-collapse">
                      <thead>
                        <tr className="bg-background/50 sticky top-0">
                          {previewColumns.map(c => (
                            <th key={c} className="text-left px-2 py-1.5 font-bold text-foreground/60 border-b border-border whitespace-nowrap text-[9px] uppercase tracking-wider">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.map((row, i) => (
                          <tr key={i} className="hover:bg-background/40 transition-colors">
                            {previewColumns.map(c => (
                              <td key={c} className="px-2 py-1 border-b border-border/30 text-foreground/70 truncate max-w-[160px]">
                                {String(row[c] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : previewContent ? (
                  <div className="flex-1 overflow-auto p-4 space-y-3 animate-fade-in-up">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2 items-start">
                        <FileText className="w-4 h-4 text-foreground/40 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-1">Document</p>
                          <p className="text-xs text-foreground/80">{previewTableName}</p>
                        </div>
                      </div>
                      {previewHasDownload && previewFileId && (
                        <a
                          href={`/api/admin/files/${previewFileId}/download`}
                          className="text-[10px] px-2 py-1 bg-foreground/10 hover:bg-foreground/20 text-foreground/70 rounded transition-colors cursor-pointer no-underline inline-flex items-center gap-1"
                        >
                          <FileText className="w-3 h-3" /> Download
                        </a>
                      )}
                    </div>
                    {previewDescription && (
                      <div className="border-t border-border pt-2">
                        <p className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-1">Description</p>
                        <p className="text-xs text-foreground/70 whitespace-pre-wrap">{previewDescription}</p>
                      </div>
                    )}
                    <div className="border-t border-border pt-2">
                      <p className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-1">Content</p>
                      <div className="text-xs text-foreground/70 whitespace-pre-wrap font-mono bg-background/50 rounded p-3 max-h-[60vh] overflow-auto">
                        {previewContent.length > 5000
                          ? previewContent.substring(0, 5000) + "\n\n... (тасарсан, бүрэн эхээр нь татаж авах)"
                          : previewContent}
                      </div>
                    </div>
                  </div>
                ) : null}
                {previewData.length > 0 && (
                  <div className="px-4 py-2 border-t border-border text-[9px] text-foreground/40 shrink-0 flex items-center justify-between">
                    <span>{previewData.length} rows shown (first 20)</span>
                  </div>
                )}
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
