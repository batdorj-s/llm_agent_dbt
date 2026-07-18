"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Search, BookOpen, ChevronDown, ChevronUp, X } from "lucide-react";

interface GlossaryEntry {
  id: string;
  term: string;
  definition: string;
  category: string;
  department?: string;
  source: string;
  keywords: string[];
  synonyms?: string[];
  column_mappings?: Array<{ column: string; tables: string[] }>;
  calculation_method?: string;
  expression?: string;
}

interface GlossaryMeta {
  total: number;
  categories: string[];
  departments: string[];
}

export function GlossaryBrowser({ token }: { token: string | null }) {
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [meta, setMeta] = useState<GlossaryMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchGlossary = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (selectedCategory) params.set("category", selectedCategory);
      if (selectedDepartment) params.set("department", selectedDepartment);

      const res = await fetch(`/api/glossary?${params.toString()}`, {
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await res.json();
      if (data.success) {
        setEntries(data.data);
        if (!meta && data.meta) setMeta(data.meta);
      }
      setError("");
    } catch { setError("Тайлбар толь татахад алдаа гарлаа."); }
    setLoading(false);
  }, [search, selectedCategory, selectedDepartment, token, meta]);

  useEffect(() => {
    const timer = setTimeout(fetchGlossary, 200);
    return () => clearTimeout(timer);
  }, [search, selectedCategory, selectedDepartment]);

  const categoryCounts = meta?.categories.reduce<Record<string, number>>((acc, cat) => {
    acc[cat] = entries.filter((e) => e.category === cat).length;
    return acc;
  }, {}) ?? {};

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {error && (
        <div className="px-4 py-2 text-[10px] text-red-500 bg-red-500/5 border-b border-red-500/20 flex items-center gap-2">
          <span>⚠</span>
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-auto text-red-400 hover:text-red-300 cursor-pointer">✕</button>
        </div>
      )}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-foreground/70">
          <BookOpen className="w-4 h-4" />
          <span className="text-xs font-semibold">Өгөгдлийн толь бичиг</span>
          {meta && <span className="text-[10px] text-foreground/40">{meta.total} нэр томьёо</span>}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Хайх..."
              className="w-48 pl-7 pr-2 py-1 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground/60 cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="text-xs rounded-md border border-border bg-background text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Бүх ангилал</option>
            {meta?.categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="text-xs rounded-md border border-border bg-background text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Бүх хэлтэс</option>
            {meta?.departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-foreground/30 text-xs animate-pulse">Ачаалж байна...</div>
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-foreground/40">
            <BookOpen className="w-8 h-8 mb-2 opacity-30" />
            <div className="text-xs">Нэр томьёо олдсонгүй</div>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-border bg-card hover:shadow-sm transition-shadow"
              >
                <button
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  className="w-full flex items-start gap-2 p-3 cursor-pointer text-left border-none bg-transparent"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-foreground">
                        {entry.term.split(" — ")[0]?.trim() || entry.term}
                      </span>
                      {entry.source && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium whitespace-nowrap">
                          {entry.source}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-foreground/50 leading-relaxed line-clamp-2">
                      {entry.definition.split("\n")[0]?.slice(0, 120)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="text-[9px] px-1 py-0.5 rounded bg-foreground/5 text-foreground/40">{entry.category}</span>
                      {entry.department && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-foreground/5 text-foreground/40">{entry.department}</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-0.5 text-foreground/30 shrink-0">
                    {expandedId === entry.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </div>
                </button>

                {expandedId === entry.id && (
                  <div className="px-3 pb-3 border-t border-border/60 pt-2">
                    <p className="text-[11px] text-foreground/70 leading-relaxed whitespace-pre-wrap">
                      {entry.definition}
                    </p>

                    {entry.synonyms && entry.synonyms.length > 0 && (
                      <div className="mt-2">
                        <span className="text-[9px] font-medium text-foreground/40">Ижил нэр: </span>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {entry.synonyms.map((s) => (
                            <span key={s} className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {entry.column_mappings && entry.column_mappings.length > 0 && (
                      <div className="mt-2">
                        <span className="text-[9px] font-medium text-foreground/40">Багана: </span>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {entry.column_mappings.map((cm) => (
                            <span key={cm.column} className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400">
                              {cm.column} ({cm.tables.join(", ")})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {entry.calculation_method && (
                      <div className="mt-2 text-[9px] text-foreground/40">
                        Тооцоо: {entry.calculation_method} of {entry.expression || "N/A"}
                      </div>
                    )}

                    {entry.keywords && entry.keywords.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {entry.keywords.slice(0, 8).map((kw) => (
                          <span key={kw} className="text-[8px] px-1 py-0.5 rounded bg-foreground/5 text-foreground/40">
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
