"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Clock, CheckCircle, XCircle, Trash2, RefreshCw, Search, ChevronDown, ChevronUp } from "lucide-react";

interface HistoryEntry {
  id: number;
  user_id: string | null;
  query: string;
  outcome: string;
  table_name: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface HistoryStats {
  total_queries: number;
  success_count: number;
  error_count: number;
  avg_duration_ms: number;
  unique_users: number;
  unique_tables: number;
}

interface HistoryTabProps {
  token: string | null;
}

const HistoryTabInner: React.FC<HistoryTabProps> = ({ token }) => {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showStats, setShowStats] = useState(false);

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [historyRes, statsRes] = await Promise.all([
        fetch("/api/history?limit=200", { headers }),
        fetch("/api/history/stats", { headers }),
      ]);
      if (!historyRes.ok) throw new Error(`HTTP ${historyRes.status}`);
      const historyData = await historyRes.json();
      if (historyData.success) setEntries(historyData.data);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        if (statsData.success) setStats(statsData.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const handleClear = async () => {
    if (!window.confirm("Бүх query түүхийг устгах уу?")) return;
    try {
      const res = await fetch("/api/history", { method: "DELETE", headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEntries([]);
      setStats(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clear failed");
    }
  };

  const filtered = entries.filter(e =>
    !searchTerm || e.query?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.table_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <main key="tab-history" className="flex-1 flex flex-col overflow-hidden min-h-0 animate-fade-in-up">
      <div className="border-b border-border px-4 py-2 flex items-center gap-2 bg-sidebar/30">
        <Clock className="w-3.5 h-3.5 text-foreground/50" />
        <span className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">SQL Query Түүх</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setShowStats(!showStats)}
            className="px-2 py-1 text-[10px] text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5 rounded transition-all cursor-pointer">
            {showStats ? "Статистик нуух" : "Статистик"}
          </button>
          <button onClick={fetchHistory} disabled={loading}
            className="px-2 py-1 text-[10px] text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5 rounded transition-all cursor-pointer disabled:opacity-40">
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={handleClear}
            className="px-2 py-1 text-[10px] text-red-400/60 hover:text-red-400 hover:bg-red-400/10 rounded transition-all cursor-pointer">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400">
          {error}
        </div>
      )}

      {stats && showStats && (
        <div className="mx-4 mt-2 grid grid-cols-3 gap-2 text-[10px]">
          <div className="px-3 py-2 bg-foreground/5 rounded border border-border">
            <div className="text-foreground/40">Нийт</div>
            <div className="text-lg font-bold text-foreground/80">{stats.total_queries}</div>
          </div>
          <div className="px-3 py-2 bg-foreground/5 rounded border border-border">
            <div className="text-foreground/40">Амжилттай</div>
            <div className="text-lg font-bold text-green-400">{stats.success_count}</div>
          </div>
          <div className="px-3 py-2 bg-foreground/5 rounded border border-border">
            <div className="text-foreground/40">Дундаж (ms)</div>
            <div className="text-lg font-bold text-foreground/80">{stats.avg_duration_ms}</div>
          </div>
        </div>
      )}

      <div className="px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2 px-2 py-1 bg-foreground/5 rounded border border-border">
          <Search className="w-3 h-3 text-foreground/30" />
          <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Query эсвэл хүснэгтээр хайх..."
            className="bg-transparent border-none outline-none text-[10px] text-foreground/70 w-full placeholder:text-foreground/20" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[10px] text-foreground/30">Ачаалж байна...</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[10px] text-foreground/30">
            {searchTerm ? "Хайлттай тохирох түүх олдсонгүй" : "Түүх хоосон байна"}
          </div>
        ) : (
          filtered.map(entry => (
            <div key={entry.id}
              className="px-4 py-2 border-b border-border/50 hover:bg-foreground/5 transition-colors cursor-pointer"
              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}>
              <div className="flex items-center gap-2">
                {entry.outcome === "success" ? (
                  <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />
                ) : (
                  <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                )}
                <code className="flex-1 text-[10px] font-mono text-foreground/70 truncate">{entry.query}</code>
                <span className="text-[9px] text-foreground/30 shrink-0">
                  {entry.duration_ms ? `${entry.duration_ms}ms` : ""}
                </span>
                {expandedId === entry.id ? <ChevronUp className="w-3 h-3 text-foreground/30" /> : <ChevronDown className="w-3 h-3 text-foreground/30" />}
              </div>
              {expandedId === entry.id && (
                <div className="mt-2 pl-5 space-y-1 text-[10px]">
                  <div className="text-foreground/50">
                    <span className="text-foreground/30">Хүснэгт:</span> {entry.table_name || "-"}
                  </div>
                  <div className="text-foreground/50">
                    <span className="text-foreground/30">Үр дүн:</span> {entry.outcome}
                  </div>
                  {entry.error && (
                    <div className="text-red-400/70">
                      <span className="text-foreground/30">Алдаа:</span> {entry.error}
                    </div>
                  )}
                  <div className="text-foreground/50">
                    <span className="text-foreground/30">Огноо:</span> {new Date(entry.created_at).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </main>
  );
};

export const HistoryTab = React.memo(HistoryTabInner);
