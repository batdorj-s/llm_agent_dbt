"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
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
  Download,
  TrendingUp,
  Users,
  DollarSign,
  Target,
  Code2,
  ChevronDown
} from "lucide-react";
import { toPng } from "html-to-image";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, Legend, CartesianGrid } from "recharts";

interface Message {
  id: string;
  sender: "user" | "agent";
  text: string;
  timestamp: Date;
  agentName?: string;
  isError?: boolean;
}

const CHART_COLORS = ["#4f46e5", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#a855f7"];
const KPI_GRADIENTS = [
  "from-indigo-500 to-indigo-600",
  "from-emerald-500 to-emerald-600",
  "from-amber-500 to-amber-600",
  "from-rose-500 to-rose-600",
];
const KPI_ICONS = [DollarSign, TrendingUp, Users, Target];

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

const downloadPng = async (ref: HTMLElement | null, filename: string) => {
  if (!ref) return;
  try {
    const dataUrl = await toPng(ref, { quality: 0.95, pixelRatio: 3, backgroundColor: "#fff" });
    const link = document.createElement("a");
    link.download = `${filename}.png`;
    link.href = dataUrl;
    link.click();
  } catch (e) {
    console.error("Download failed:", e);
  }
};

const formatValue = (v: unknown): string => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? String(v ?? "") : n.toLocaleString();
};

const sharedTooltipStyle = (): React.CSSProperties => ({
  backgroundColor: "var(--background)",
  border: "1px solid var(--card-border)",
  borderRadius: "8px",
  fontSize: "11px",
  color: "var(--foreground)",
  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  padding: "8px 12px",
});

const VisualMessage = ({ visualJson }: { visualJson: string }) => {
  const chartRef = useRef<HTMLDivElement>(null);
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

  const chartData = data.data as Record<string, unknown>[];
  const config = data.config || {};
  const colors = (config.colors as string[]) || CHART_COLORS;
  const series = config.series as string[] | undefined;
  const stacked = config.stacked === true;
  const tooltipStyle = sharedTooltipStyle();
  const fmt = (v: any) => formatValue(v);
  const tickFmt = (v: any) => {
    const n = Number(v);
    return isNaN(n) ? String(v) : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
  };

  const renderMultiSeries = (ChartComponent: any, DataComponent: any, extraProps?: Record<string, unknown>) => {
    const s = series || ["value"];
    return (
      <ChartComponent data={chartData} layout={extraProps?.layout || undefined}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
        {extraProps?.layout === "vertical" ? null : <XAxis dataKey="label" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />}
        {extraProps?.layout === "vertical" ? <YAxis dataKey="label" type="category" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} /> : <YAxis stroke="#888888" fontSize={10} tickLine={false} axisLine={false} tickFormatter={tickFmt} />}
        {extraProps?.layout === "vertical" ? <XAxis type="number" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} /> : null}
        <Tooltip contentStyle={tooltipStyle} formatter={fmt} />
        {s.length > 1 && <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "8px" }} />}
        {s.map((key, i) => (
          <DataComponent key={key} type="monotone" dataKey={key} fill={colors[i % colors.length]} stroke={colors[i % colors.length]} strokeWidth={2} stackId={stacked ? "stack" : undefined} />
        ))}
      </ChartComponent>
    );
  };

  const renderChart = () => {
    switch (data.type) {
      case "bar":
        if (stacked || (series && series.length > 1)) return renderMultiSeries(BarChart, Bar);
        return (
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
            <XAxis dataKey="label" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#888888" fontSize={10} tickLine={false} axisLine={false} tickFormatter={tickFmt} />
            <Tooltip contentStyle={tooltipStyle} formatter={fmt} />
            <Bar dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        );
      case "horizontal_bar":
        if (series && series.length > 1) return renderMultiSeries(BarChart, Bar, { layout: "vertical" });
        return (
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" horizontal={false} />
            <XAxis type="number" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} tickFormatter={tickFmt} />
            <YAxis dataKey="label" type="category" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} width={90} />
            <Tooltip contentStyle={tooltipStyle} formatter={fmt} />
            <Bar dataKey="value" fill={colors[0]} radius={[0, 4, 4, 0]} maxBarSize={24} />
          </BarChart>
        );
      case "line":
        if (series && series.length > 1) return renderMultiSeries(LineChart, Line);
        return (
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
            <XAxis dataKey="label" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#888888" fontSize={10} tickLine={false} axisLine={false} tickFormatter={tickFmt} />
            <Tooltip contentStyle={tooltipStyle} formatter={fmt} />
            <Line type="monotone" dataKey="value" stroke={colors[0]} strokeWidth={2} dot={{ r: 3, fill: colors[0], strokeWidth: 0 }} activeDot={{ r: 5 }} />
          </LineChart>
        );
      case "area":
        if (series && series.length > 1) return renderMultiSeries(AreaChart, Area);
        return (
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={`areaGrad-${data.title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors[0]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={colors[0]} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
            <XAxis dataKey="label" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#888888" fontSize={10} tickLine={false} axisLine={false} tickFormatter={tickFmt} />
            <Tooltip contentStyle={tooltipStyle} formatter={fmt} />
            <Area type="monotone" dataKey="value" fill={`url(#areaGrad-${data.title})`} stroke={colors[0]} strokeWidth={2} />
          </AreaChart>
        );
      case "pie":
        return (
          <PieChart>
            <Tooltip contentStyle={tooltipStyle} formatter={fmt} />
            <Pie data={chartData} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={2}
              label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""}: ${value ?? 0}`}>
              {chartData.map((_: any, i: number) => (
                <Cell key={i} fill={colors[i % colors.length]} stroke="transparent" />
              ))}
            </Pie>
          </PieChart>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-sidebar border border-border rounded-lg p-4 mt-2 max-w-lg transition-colors duration-200 shadow-sm" ref={chartRef}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[11px] font-bold text-foreground/80 uppercase tracking-wider">{data.title}</h4>
        <button onClick={() => downloadPng(chartRef.current, data.title || "chart")}
          className="p-1 rounded hover:bg-background/80 transition-colors text-foreground/40 hover:text-foreground/70" title="Download PNG">
          <Download size={14} />
        </button>
      </div>
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const DashboardWidget = ({ widget, kpiIndex = 0 }: { widget: any; kpiIndex?: number }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [animValue, setAnimValue] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (widget.type === "kpi" && widget.value != null) {
      const target = Number(widget.value);
      const duration = 800;
      const start = performance.now();
      const animate = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setAnimValue(Math.round(target * eased));
        if (progress < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }
  }, [widget.value, widget.type]);

  const tooltipStyle = sharedTooltipStyle();

  if (widget.type === "kpi") {
    const KpiIcon = KPI_ICONS[kpiIndex % KPI_ICONS.length];
    const gradient = KPI_GRADIENTS[kpiIndex % KPI_GRADIENTS.length];
    return (
      <div className={`bg-gradient-to-br ${gradient} rounded-xl p-4 flex flex-col justify-center shadow-sm text-white relative overflow-hidden`}>
        <div className="absolute top-2 right-2 opacity-20">
          <KpiIcon size={36} />
        </div>
        <div className="text-[10px] font-medium uppercase tracking-wider opacity-80">{widget.title}</div>
        <div className="text-2xl font-bold mt-1 tracking-tight">
          {animValue.toLocaleString()}
          {widget.unit && <span className="text-sm font-normal opacity-80 ml-1">{widget.unit}</span>}
        </div>
      </div>
    );
  }

  if (!widget.data || !Array.isArray(widget.data) || widget.data.length === 0) {
    return (
      <div className="bg-background border border-border rounded-lg p-3">
        <div className="text-[9px] font-bold text-foreground/60 uppercase mb-2">{widget.title}</div>
        <div className="text-[9px] text-foreground/40">{widget.error || "No data"}</div>
      </div>
    );
  }

  const colors = CHART_COLORS;

  const renderChart = () => {
    switch (widget.type) {
      case "bar":
        return (
          <BarChart data={widget.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
            <XAxis dataKey="label" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#888888" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        );
      case "horizontal_bar":
        return (
          <BarChart data={widget.data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" horizontal={false} />
            <XAxis type="number" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
            <YAxis dataKey="label" type="category" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} width={90} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" fill={colors[0]} radius={[0, 4, 4, 0]} maxBarSize={20} />
          </BarChart>
        );
      case "line":
        return (
          <LineChart data={widget.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
            <XAxis dataKey="label" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#888888" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="value" stroke={colors[0]} strokeWidth={2} dot={{ r: 3, fill: colors[0], strokeWidth: 0 }} activeDot={{ r: 5 }} />
          </LineChart>
        );
      case "area":
        return (
          <AreaChart data={widget.data}>
            <defs>
              <linearGradient id={`dashAreaGrad-${widget.title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors[0]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={colors[0]} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
            <XAxis dataKey="label" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#888888" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="value" fill={`url(#dashAreaGrad-${widget.title})`} stroke={colors[0]} strokeWidth={2} />
          </AreaChart>
        );
      case "pie":
        return (
          <PieChart>
            <Tooltip contentStyle={tooltipStyle} />
            <Pie data={widget.data} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={42} outerRadius={60} paddingAngle={2}
              label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""}: ${value ?? 0}`}>
              {widget.data.map((_: any, i: number) => (
                <Cell key={i} fill={colors[i % colors.length]} stroke="transparent" />
              ))}
            </Pie>
          </PieChart>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-background border border-border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow duration-200" ref={chartRef}>
      <div className="flex items-center justify-between mb-2">
        <h5 className="text-[10px] font-bold text-foreground/70 uppercase tracking-wider">{widget.title}</h5>
        <button onClick={() => downloadPng(chartRef.current, widget.title || "widget")}
          className="p-1 rounded hover:bg-background/80 transition-colors text-foreground/30 hover:text-foreground/60" title="Download PNG">
          <Download size={12} />
        </button>
      </div>
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

const SqlBlock = ({ code }: { code: string }) => {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <div className="my-2 rounded-lg overflow-hidden border border-border/50 shadow-sm">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-codebg/90 text-codetext/70 text-[10px] font-mono cursor-pointer hover:bg-codebg transition-colors"
      >
        <Code2 className="w-3 h-3 text-accent" />
        <span className="text-accent font-semibold tracking-wide">SQL</span>
        <span className="text-codetext/40 truncate flex-1 text-left ml-1">
          {code.split("\n")[0].substring(0, 60)}
          {code.split("\n")[0].length > 60 ? "..." : ""}
        </span>
        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-200 ${collapsed ? "max-h-0" : "max-h-[600px]"}`}>
        <pre className="m-0 p-3 bg-codebg text-codetext text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
          {code}
        </pre>
      </div>
    </div>
  );
};

const DashboardMessage = ({ dashboardJson }: { dashboardJson: string }) => {
  const dashRef = useRef<HTMLDivElement>(null);
  let widgets: any[];
  try {
    widgets = JSON.parse(dashboardJson);
  } catch (e) {
    return <div className="text-[9px] text-red-500">Failed to render dashboard: {String(e)}</div>;
  }

  if (!Array.isArray(widgets) || widgets.length === 0) {
    return <div className="text-[9px] text-red-500">Invalid dashboard data</div>;
  }

  const kpiWidgets = widgets.filter((w: any) => w.type === "kpi");
  const chartWidgets = widgets.filter((w: any) => w.type !== "kpi");

  return (
    <div className="bg-sidebar border border-border rounded-xl p-4 mt-2 max-w-4xl transition-colors duration-200 shadow-sm" ref={dashRef}>
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-[11px] font-bold text-foreground/80 uppercase tracking-wider flex items-center gap-2">
          <BarChart2 size={14} className="text-foreground/60" />
          Dashboard
        </h4>
        <div className="flex gap-1">
          <button onClick={() => downloadPng(dashRef.current, "dashboard")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-background border border-border hover:bg-foreground/5 transition-colors text-[10px] text-foreground/60 hover:text-foreground/80">
            <Download size={12} />
            Export PNG
          </button>
        </div>
      </div>
      {kpiWidgets.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          {kpiWidgets.map((w: any, i: number) => (
            <DashboardWidget key={`kpi-${i}`} widget={w} kpiIndex={i} />
          ))}
        </div>
      )}
      {chartWidgets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {chartWidgets.map((w: any, i: number) => (
            <DashboardWidget key={`chart-${i}`} widget={w} />
          ))}
        </div>
      )}
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
          text: `Тавтай морилно уу! Би бол **Байгууллагын AI зохицуулагч** байна. Надаас санхүүгийн асуултууд асуух эсвэл код ажиллуулах даалгавар өгөх боломжтой.`,
          timestamp: new Date(),
          agentName: "Supervisor Router",
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
      agentName: "Supervisor Router",
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

                  let detectedAgent = "Supervisor Router";
                  let nodeState: typeof activeRoutingState = "routing";

                  if (fullResponse.includes("(Finance Agent)")) {
                    detectedAgent = "Finance Agent";
                    nodeState = "finance";
                  } else if (fullResponse.includes("(Tech Agent)")) {
                    detectedAgent = "Tech Agent";
                    nodeState = "tech";
                  } else if (fullResponse.includes("🛑 Security Alert")) {
                    detectedAgent = "Security Manager";
                    nodeState = "idle";
                  }

                  setActiveRoutingState(nodeState);
                  setLastAgentResponded(detectedAgent);

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

    const blockPattern = new RegExp(
      "(<(?:visual|dashboard)>[\\s\\S]*?<\\/(?:visual|dashboard)>|```sql\\n[\\s\\S]*?```)",
      "g"
    );
    const parts = text.split(blockPattern);

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
      if (part.startsWith("```sql")) {
        const code = part.replace(/```sql\n?|```\n?/g, "");
        return <SqlBlock key={idx} code={code} />;
      }

      const lines = part.split("\n");
      return lines.map((line, lineIdx) => {
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
        <div className="h-screen overflow-hidden font-sans antialiased text-xs flex flex-col transition-colors duration-200" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
      
      {/* HEADER */}
      <header className="apple-header px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="font-bold text-sm tracking-tight" style={{ color: "var(--foreground)" }}>Enterprise Orchestrator</span>
          <span className="text-[10px] font-mono" style={{ color: "var(--foreground)", opacity: 0.35 }}>v1.2</span>
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
        <main className="flex-1 flex items-center justify-center p-4" style={{ backgroundColor: "var(--background)" }}>
          <div className="w-full border max-w-sm" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", borderRadius: "14px", padding: "24px", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
            <div className="text-center mb-5">
              <h2 className="text-sm font-bold tracking-tight" style={{ color: "var(--foreground)" }}>Sign In</h2>
            </div>

            <form onSubmit={(e) => handleLogin(e)} className="space-y-3">
              <div>
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="apple-input w-full"
                />
              </div>

              <div>
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="apple-input w-full"
                />
              </div>

              <button
                type="submit"
                disabled={isAuthLoading}
                className="apple-send-btn w-full flex items-center justify-center"
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
          <section className="w-full md:w-[320px] shrink-0 p-5 flex flex-col overflow-y-auto scrollbar-hide space-y-6 md:flex hidden" style={{ borderRight: "1px solid var(--card-border)", backgroundColor: "var(--sidebar-bg)" }}>
            
            {/* KPI METRICS */}
            <div className="space-y-3">
              <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "var(--foreground)", opacity: 0.35 }}>Metrics</div>
              
              {/* Sales Metric */}
              <div className="py-2" style={{ borderBottom: "1px solid var(--card-border)" }}>
                <span className="text-[10px] uppercase font-semibold" style={{ color: "var(--foreground)", opacity: 0.5 }}>Sales Revenue</span>
                <div className="flex justify-between items-baseline mt-0.5">
                  <span className="text-sm font-bold" style={{ color: "var(--foreground)" }}>
                    {salesKpi ? `$${salesKpi.current.toLocaleString()}` : "—"}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: "var(--foreground)", opacity: 0.4 }}>
                    Target: {salesKpi ? `$${salesKpi.target.toLocaleString()}` : "—"}
                  </span>
                </div>
              </div>

              {/* Users Metric */}
              <div className="py-2" style={{ borderBottom: "1px solid var(--card-border)" }}>
                <span className="text-[10px] uppercase font-semibold" style={{ color: "var(--foreground)", opacity: 0.5 }}>Active Users</span>
                <div className="flex justify-between items-baseline mt-0.5">
                  <span className="text-sm font-bold" style={{ color: "var(--foreground)" }}>
                    {usersKpi ? usersKpi.current.toLocaleString() : "—"}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: "var(--foreground)", opacity: 0.4 }}>
                    Goal: {usersKpi ? usersKpi.target : "—"}
                  </span>
                </div>
              </div>

              {/* Churn Metric */}
              <div className="py-2">
                <span className="text-[10px] uppercase font-semibold" style={{ color: "var(--foreground)", opacity: 0.5 }}>Churn Rate</span>
                <div className="flex justify-between items-baseline mt-0.5">
                  <span className={`text-sm font-bold ${churnKpi && churnKpi.current > churnKpi.target ? "text-red-500" : "text-emerald-500"}`}>
                    {churnKpi ? `${churnKpi.current}%` : "—"}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: "var(--foreground)", opacity: 0.4 }}>
                    Limit: {churnKpi ? `${churnKpi.target}%` : "—"}
                  </span>
                </div>
              </div>
            </div>

            {user && (
              <div className="pt-5 space-y-4" style={{ borderTop: "1px solid var(--card-border)" }}>
                
                {/* PYTHON CONSOLE */}
                <div className="space-y-2">
                  <span className="text-[9px] font-bold uppercase tracking-widest block" style={{ color: "var(--foreground)", opacity: 0.35 }}>Sandbox Code VM</span>
                  <textarea
                    value={adminCode}
                    onChange={(e) => setAdminCode(e.target.value)}
                    className="apple-input w-full h-20 font-mono text-[10px]"
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
                      uploadedFiles.map((f) => (
                        <div key={f.id} className="group flex items-center justify-between bg-background border border-border/80 hover:border-foreground/20 rounded px-2 py-1.5 transition-colors">
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
          <section className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ backgroundColor: "var(--background)" }}>
            
            {/* ROUTING INDICATOR */}
            <div className="py-2 px-6 flex items-center justify-between" style={{ borderBottom: "1px solid var(--card-border)", backgroundColor: "var(--sidebar-bg)" }}>
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--foreground)", opacity: 0.45 }}>
                <span className={`w-1.5 h-1.5 rounded-full ${activeRoutingState !== "idle" && activeRoutingState !== "done" ? "bg-[var(--accent)] animate-pulse" : ""}`} style={{ backgroundColor: activeRoutingState === "idle" || activeRoutingState === "done" ? "var(--foreground)" : undefined, opacity: activeRoutingState === "idle" || activeRoutingState === "done" ? 0.3 : 1 }} />
                Agent Path
              </div>
              <div className="flex gap-3 items-center font-mono text-[9px]">
                <span style={{ color: activeRoutingState === "routing" ? "var(--foreground)" : "var(--foreground)", opacity: activeRoutingState === "routing" ? 1 : 0.35 }}>Router</span>
                <span style={{ color: "var(--foreground)", opacity: 0.25 }}>→</span>
                <span style={{ color: activeRoutingState === "finance" ? "var(--accent)" : "var(--foreground)", opacity: activeRoutingState === "finance" ? 1 : 0.35, fontWeight: activeRoutingState === "finance" ? 700 : 400 }}>Finance</span>
                <span style={{ color: "var(--foreground)", opacity: 0.25 }}>/</span>
                <span style={{ color: activeRoutingState === "tech" ? "var(--accent)" : "var(--foreground)", opacity: activeRoutingState === "tech" ? 1 : 0.35, fontWeight: activeRoutingState === "tech" ? 700 : 400 }}>Tech</span>
              </div>
            </div>

            {/* CHAT MESSAGES THREAD */}
            <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-6 flex flex-col justify-start">
              {messages.length === 0 ? (
                <div className="text-center my-auto" style={{ color: "var(--foreground)", opacity: 0.35 }}>
                  <p className="font-semibold tracking-tight">Ready</p>
                  <p className="text-[10px] mt-1" style={{ opacity: 0.6 }}>Ask a question to begin.</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div className="max-w-2xl w-full flex flex-col">
                      {msg.sender === "user" ? (
                        <div className="apple-user-bubble">
                          {msg.text}
                        </div>
                      ) : (
                        <div className="apple-agent-card">
                          {msg.agentName && (
                            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--accent)", opacity: 0.8 }}>
                              {msg.agentName}
                            </span>
                          )}
                          <div className="text-xs leading-relaxed" style={{ color: "var(--foreground)", opacity: 0.85 }}>
                            {formatMessageText(msg.text)}

                            {msg.text === "" && (
                              <div className="flex gap-1.5 items-center py-1.5">
                                <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--accent)", opacity: 0.5, animationDelay: "0ms" }} />
                                <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--accent)", opacity: 0.35, animationDelay: "200ms" }} />
                                <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--accent)", opacity: 0.2, animationDelay: "400ms" }} />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
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

              <div className="flex gap-2.5 items-center max-w-3xl mx-auto w-full">
                <input
                  type="text"
                  placeholder="Message..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isChatLoading}
                  className="apple-input flex-1 disabled:opacity-50"
                />
                {isChatLoading ? (
                  <button
                    type="button"
                    onClick={handleCancelMessage}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all cursor-pointer active:scale-95 duration-150 text-xs font-semibold"
                    title="Stop"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isChatLoading || !input.trim()}
                    className="apple-send-btn disabled:opacity-30 disabled:pointer-events-none cursor-pointer flex items-center justify-center"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </form>

          </section>
        </main>
      )}
    </div>
  );
}
