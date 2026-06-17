"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Lock,
  User,
  LogOut,
  Shield,
  Activity,
  ChevronRight,
  Terminal,
  HelpCircle,
  TrendingUp,
  Users,
  Percent,
  BarChart2,
  Trash2,
  FileText,
  Sun,
  Moon,
  Square
} from "lucide-react";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

interface Message {
  id: string;
  sender: "user" | "agent";
  text: string;
  timestamp: Date;
  agentName?: string;
  isError?: boolean;
}

const VisualMessage = ({ visualJson }: { visualJson: string }) => {
  try {
    // Aggressive sanitization: remove all leading { and trailing } then wrap once
    let cleaned = visualJson.trim();
    while (cleaned.startsWith("{")) {
      cleaned = cleaned.slice(1);
    }
    while (cleaned.endsWith("}")) {
      cleaned = cleaned.slice(0, -1);
    }
    const sanitizedJson = `{${cleaned}}`;
    
    console.log("Visual JSON Raw:", visualJson);
    console.log("Sanitized JSON:", sanitizedJson);
    const data = JSON.parse(sanitizedJson);
    console.log("Parsed Visual Data:", data);
    if (!data.data || !Array.isArray(data.data)) return <div className="text-[9px] text-red-500">Invalid data format</div>;

    return (
      <div className="bg-sidebar border border-border rounded-lg p-4 mt-2 max-w-lg transition-colors duration-200">
        <h4 className="text-[10px] font-bold text-foreground/60 uppercase mb-3">{data.title}</h4>
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {data.type === "bar" ? (
              <BarChart data={data.data}>
                <XAxis dataKey="label" stroke="#888888" fontSize={9} />
                <YAxis stroke="#888888" fontSize={9} />
                <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
                <Bar dataKey="value" fill="var(--foreground)" />
              </BarChart>
            ) : data.type === "line" ? (
              <LineChart data={data.data}>
                <XAxis dataKey="label" stroke="#888888" fontSize={9} />
                <YAxis stroke="#888888" fontSize={9} />
                <Tooltip contentStyle={{ backgroundColor: "var(--background)", border: "1px solid var(--card-border)", fontSize: "10px", color: "var(--foreground)" }} />
                <Line type="monotone" dataKey="value" stroke="var(--foreground)" />
              </LineChart>
            ) : null}
          </ResponsiveContainer>
        </div>
      </div>
    );
  } catch (e) {
    console.error("Visual JSON Parse Error:", e);
    return <div className="text-[9px] text-red-500">Failed to render graphic: {String(e)}</div>;
  }
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
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // Chat states
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [threadId, setThreadId] = useState<string>("");
  const [streamEnabled, setStreamEnabled] = useState(true);

  // Dashboard / System metrics states
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [salesKpi, setSalesKpi] = useState<KpiData | null>(null);
  const [usersKpi, setUsersKpi] = useState<KpiData | null>(null);
  const [churnKpi, setChurnKpi] = useState<KpiData | null>(null);
  const [salesHistory, setSalesHistory] = useState<SalesHistory[]>([]);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState<number>(5);

  // Visual graph animation states
  const [activeRoutingState, setActiveRoutingState] = useState<"idle" | "routing" | "finance" | "tech" | "done">("idle");
  const [lastAgentResponded, setLastAgentResponded] = useState<string | null>(null);

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
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [isFilesLoading, setIsFilesLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Theme state
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // Load auth state and theme from LocalStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem("agent_token");
    const storedUser = localStorage.getItem("agent_user");
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      setIsLoggedIn(true);
      setThreadId(`thread_${Date.now()}`);
    }
    fetchServerStatus();

    // Theme initialization
    const storedTheme = localStorage.getItem("theme") as "light" | "dark";
    if (storedTheme) {
      setTheme(storedTheme);
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setTheme(prefersDark ? "dark" : "light");
    }
  }, []);

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

  // Fetch metrics when logged in or history limit changes
  useEffect(() => {
    if (isLoggedIn && token) {
      fetchDashboardData();
      fetchUploadedFiles();
    }
  }, [isLoggedIn, token, historyLimit]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchServerStatus = async () => {
    try {
      const res = await fetch("http://localhost:3001/api/status");
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

      // Sales KPI
      const salesRes = await fetch("http://localhost:3001/api/kpi/sales", { headers });
      if (salesRes.ok) {
        const data = await salesRes.json();
        setSalesKpi(data);
      } else if (salesRes.status === 401) {
        handleLogout();
        return;
      }

      // Users KPI
      const usersRes = await fetch("http://localhost:3001/api/kpi/users", { headers });
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsersKpi(data);
      }

      // Churn KPI
      const churnRes = await fetch("http://localhost:3001/api/kpi/churn_rate", { headers });
      if (churnRes.ok) {
        const data = await churnRes.json();
        setChurnKpi(data);
      }

      // History
      const historyRes = await fetch(`http://localhost:3001/api/kpi-history?limit=${historyLimit}`, { headers });
      if (historyRes.ok) {
        const data = await historyRes.json();
        setSalesHistory(data);
      }
    } catch (e: any) {
      setDashboardError("Could not retrieve KPI data. Ensure API server is running.");
      console.error("Dashboard fetch error", e);
    }
  };

  const fetchUploadedFiles = async () => {
    if (!token) return;
    setIsFilesLoading(true);
    try {
      const res = await fetch("http://localhost:3001/api/admin/files", {
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

  const handleDeleteFile = async (id: string) => {
    if (!token || !confirm("Are you sure you want to delete this asset?")) return;
    try {
      const res = await fetch(`http://localhost:3001/api/admin/files/${id}`, {
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
      const res = await fetch("http://localhost:3001/api/auth/login", {
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
    } catch (e: any) {
      alert(e.message || "Connection to API Server failed.");
    } finally {
      setIsAuthLoading(false);
    }
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

  const handleSendMessage = async (e?: React.FormEvent, customInput?: string) => {
    if (e) e.preventDefault();
    const query = customInput || input;
    if (!query.trim() || isChatLoading || !token) return;

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
        const response = await fetch("http://localhost:3001/api/chat/stream", {
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
        const res = await fetch("http://localhost:3001/api/chat", {
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

        const data = await res.json();
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
    } catch (e: any) {
      if (e.name === "AbortError") {
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
      setActiveRoutingState("idle");
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === agentMsgId
            ? {
                ...msg,
                text: e.message || "An error occurred while communicating with the agent system.",
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
      const res = await fetch("http://localhost:3001/api/admin/run-code", {
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
    } catch (e: any) {
      setAdminCodeOutput(`Error: ${e.message}`);
    } finally {
      setIsAdminRunningCode(false);
    }
  };

  const handleUpdateKpiTarget = async () => {
    if (newTargetValue === undefined || isNaN(newTargetValue) || isUpdatingTarget || !token) return;
    setIsUpdatingTarget(true);
    setSalesUpdateSuccess(null);

    try {
      const res = await fetch(`http://localhost:3001/api/kpi/${adjustMetric}/target`, {
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
    } catch (e: any) {
      setSalesUpdateSuccess(`Error: ${e.message}`);
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
        const res = await fetch("http://localhost:3001/api/admin/upload-csv", {
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
      } catch (err: any) {
        setCsvUploadMessage(`Error: ${err.message}`);
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
      const res = await fetch("http://localhost:3001/api/admin/upload-doc", {
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
    } catch (err: any) {
      setDocUploadMessage(`Error: ${err.message}`);
    } finally {
      setIsUploadingDoc(false);
    }
  };

  const formatMessageText = (text: string) => {
    if (!text) return "";

    // Split by <visual> tags while preserving the tagged blocks.
    const visualTagPattern = new RegExp("(<visual>[\\s\\S]*?<\\/visual>)", "g");
    const parts = text.split(visualTagPattern);

    return parts.map((part, idx) => {
      if (part.startsWith("<visual>")) {
        const visualTagStripPattern = new RegExp("<\\/?visual>", "g");
        const jsonContent = part.replace(visualTagStripPattern, "");
        return <VisualMessage key={idx} visualJson={jsonContent} />;
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
          <span className="font-bold text-foreground text-sm tracking-tight">Enterprise Orchestrator</span>
          <span className="text-[10px] text-foreground/50 font-mono">v1.2</span>
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
                      onChange={(e: any) => setAdjustMetric(e.target.value)}
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
          <section className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
            
            {/* MINIMALIST ROUTING INDICATOR */}
            <div className="border-b border-border py-2.5 px-6 flex items-center justify-between bg-sidebar/50 transition-colors duration-200">
              <div className="flex items-center gap-1.5 text-foreground/50 text-[10px] uppercase font-bold tracking-wider">
                <span className={`w-1.5 h-1.5 rounded-full ${activeRoutingState !== "idle" && activeRoutingState !== "done" ? "bg-foreground animate-pulse" : "bg-foreground/30"}`} />
                Orchestrator Path
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
                <div className="text-center text-foreground/40 my-auto">
                  <p className="font-semibold">Orchestration thread active.</p>
                  <p className="text-[10px] mt-1">Submit a financial question or coding task to begin.</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
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
                  placeholder="Message orchestrator..."
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

          </section>
        </main>
      )}
    </div>
  );
}
