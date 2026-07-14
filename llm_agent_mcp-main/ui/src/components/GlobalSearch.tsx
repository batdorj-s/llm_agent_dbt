"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, Database, BookOpen, GitBranch, ShieldAlert } from "lucide-react";

interface SearchResult {
  type: "catalog" | "glossary" | "lineage" | "quality";
  title: string;
  description: string;
  matchField: string;
  score: number;
  meta?: Record<string, any>;
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  catalog: { icon: <Database className="w-3 h-3" />, color: "text-blue-500" },
  glossary: { icon: <BookOpen className="w-3 h-3" />, color: "text-emerald-500" },
  lineage: { icon: <GitBranch className="w-3 h-3" />, color: "text-purple-500" },
  quality: { icon: <ShieldAlert className="w-3 h-3" />, color: "text-amber-500" },
};

export function GlobalSearch({ token }: { token: string | null }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers });
      const json = await res.json();
      setResults(json.data || []);
      setSelectedIdx(0);
    } catch { setResults([]); }
    setLoading(false);
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Escape") { setOpen(false); setQuery(""); setResults([]); inputRef.current?.blur(); }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-foreground/5 focus-within:border-blue-500/50 focus-within:bg-foreground/10 transition-all min-w-[160px] md:min-w-[240px]">
        <Search className="w-3 h-3 text-foreground/30" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder="Хайх..."
          className="flex-1 bg-transparent border-none outline-none text-[10px] text-foreground placeholder:text-foreground/20 min-w-0"
        />
        {query && (
          <button onClick={() => { setQuery(""); setResults([]); }} className="text-foreground/20 hover:text-foreground/50 cursor-pointer">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {open && (results.length > 0 || loading) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg z-[100] max-h-80 overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-[10px] text-foreground/40">Хайж байна...</div>
          )}
          {!loading && results.map((r, i) => {
            const cfg = TYPE_CONFIG[r.type] || TYPE_CONFIG.catalog;
            return (
              <div
                key={`${r.type}-${r.title}-${i}`}
                className={`flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors ${
                  i === selectedIdx ? "bg-foreground/10" : "hover:bg-foreground/5"
                }`}
                onMouseDown={() => { setOpen(false); }}
              >
                <span className={`mt-0.5 ${cfg.color}`}>{cfg.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-foreground truncate">{r.title}</div>
                  <div className="text-[9px] text-foreground/40 truncate">{r.description || r.type}</div>
                </div>
                <span className="text-[8px] text-foreground/30 uppercase">{r.type}</span>
              </div>
            );
          })}
          <div className="px-3 py-1.5 text-[8px] text-foreground/20 border-t border-border/40 text-center">
            {results.length} үр дүн
          </div>
        </div>
      )}
    </div>
  );
}
