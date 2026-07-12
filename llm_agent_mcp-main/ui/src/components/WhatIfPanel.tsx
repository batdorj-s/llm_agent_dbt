"use client";

import React, { useState, useEffect } from "react";
import { GitBranch, Play, X, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface WhatIfResult {
  scenario: {
    name: string;
    column: string;
    changePercent: number;
    targetColumn: string;
    rowsAffected: number;
  };
  baseline: {
    columnSum: number;
    columnMean: number;
    targetSum: number;
    targetMean: number;
  };
  projected: {
    targetSum: number;
    targetMean: number;
  };
  impact: {
    absolute: number;
    percent: number;
  };
  categoryImpact: Array<{
    category: string;
    baseline: number;
    projected: number;
    change: number;
  }>;
}

interface WhatIfPanelProps {
  token: string;
}

export function WhatIfPanel({ token }: WhatIfPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedColumn, setSelectedColumn] = useState("");
  const [changePercent, setChangePercent] = useState(10);
  const [scenarioName, setScenarioName] = useState("");
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch column list when panel opens
  useEffect(() => {
    if (!isOpen || columns.length > 0) return;
    const fetchColumns = async () => {
      try {
        const res = await fetch("/api/kpi/anomalies?limit=1", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.columns?.length) {
          setColumns(data.columns);
          setSelectedColumn(data.columns[0]);
        }
      } catch { /* best-effort */ }
    };
    fetchColumns();
  }, [isOpen, token, columns.length]);

  const handleRun = async () => {
    if (!selectedColumn) return;
    setIsLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/whatif", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          column: selectedColumn,
          changePercent,
          scenarioName: scenarioName || `${selectedColumn} ${changePercent > 0 ? "+" : ""}${changePercent}%`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scenario failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run scenario");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border bg-card text-foreground/60 rounded-lg hover:bg-foreground/5 transition-all cursor-pointer">
        <GitBranch className="w-3.5 h-3.5" />
        What-If
      </button>
    );
  }

  return (
    <div className="border border-border rounded-xl bg-card shadow-sm overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/50">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-blue-500" />
          <span className="text-xs font-medium">What-If Сценарий</span>
        </div>
        <button onClick={() => { setIsOpen(false); setResult(null); }}
          className="text-foreground/40 hover:text-foreground/80 cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Controls */}
      <div className="p-4 space-y-3">
        {columns.length === 0 ? (
          <p className="text-xs text-foreground/40 text-center py-4">Дата олдсонгүй</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {/* Column */}
              <div>
                <label className="block text-[10px] text-foreground/50 uppercase tracking-wider mb-1">Багана</label>
                <select value={selectedColumn} onChange={e => setSelectedColumn(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:border-foreground/30">
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Change Percent */}
              <div>
                <label className="block text-[10px] text-foreground/50 uppercase tracking-wider mb-1">Өөрчлөлт (%)</label>
                <input type="number" value={changePercent} onChange={e => setChangePercent(Number(e.target.value))}
                  className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:border-foreground/30"
                  step={5} min={-100} max={1000} />
              </div>

              {/* Quick Presets */}
              <div>
                <label className="block text-[10px] text-foreground/50 uppercase tracking-wider mb-1">Хурдан</label>
                <div className="flex gap-1">
                  {[-20, -10, 10, 20].map(v => (
                    <button key={v} onClick={() => setChangePercent(v)}
                      className={`flex-1 py-1 text-[10px] rounded border transition-colors cursor-pointer ${
                        changePercent === v
                          ? "bg-foreground text-background border-foreground"
                          : "border-border text-foreground/50 hover:bg-foreground/5"
                      }`}>
                      {v > 0 ? "+" : ""}{v}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Scenario Name */}
            <div>
              <label className="block text-[10px] text-foreground/50 uppercase tracking-wider mb-1">Нэр (заавал биш)</label>
              <input type="text" value={scenarioName} onChange={e => setScenarioName(e.target.value)}
                placeholder="Жишээ: Зардал өсгөх сценарий"
                className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:border-foreground/30" />
            </div>

            {/* Run Button */}
            <button onClick={handleRun} disabled={isLoading || !selectedColumn}
              className="w-full flex items-center justify-center gap-1.5 py-2 bg-foreground text-background text-xs font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer">
              {isLoading ? (
                <span>Тооцоолж байна...</span>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  Сценарий ажиллуулах
                </>
              )}
            </button>
          </>
        )}

        {error && (
          <div className="text-xs text-red-500 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="border-t border-border p-4 space-y-4">
          {/* Impact Summary */}
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
              result.impact.percent > 0 ? "bg-green-500/10" : result.impact.percent < 0 ? "bg-red-500/10" : "bg-foreground/5"
            }`}>
              {result.impact.percent > 0 ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : result.impact.percent < 0 ? (
                <TrendingDown className="w-4 h-4 text-red-500" />
              ) : (
                <Minus className="w-4 h-4 text-foreground/40" />
              )}
              <div>
                <p className="text-[10px] text-foreground/50">Нөлөөлөл</p>
                <p className={`text-sm font-bold ${result.impact.percent > 0 ? "text-green-500" : result.impact.percent < 0 ? "text-red-500" : "text-foreground"}`}>
                  {result.impact.percent > 0 ? "+" : ""}{result.impact.percent.toFixed(1)}%
                </p>
              </div>
            </div>
            <div className="text-xs text-foreground/50">
              <p>{result.scenario.rowsAffected} мөрөөд</p>
              <p>{result.scenario.targetColumn} баганад</p>
            </div>
          </div>

          {/* Before / After Table */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-background rounded-lg border border-border/50">
              <p className="text-[10px] text-foreground/50 uppercase tracking-wider mb-1">Өмнө</p>
              <p className="text-lg font-bold text-foreground">{result.baseline.targetSum.toLocaleString()}</p>
              <p className="text-[10px] text-foreground/40">Дүн нийлбэр</p>
            </div>
            <div className="p-3 bg-background rounded-lg border border-border/50">
              <p className="text-[10px] text-foreground/50 uppercase tracking-wider mb-1">Дараа</p>
              <p className="text-lg font-bold text-foreground">{result.projected.targetSum.toLocaleString()}</p>
              <p className="text-[10px] text-foreground/40">Дүн нийлбэр</p>
            </div>
          </div>

          {/* Category Breakdown */}
          {result.categoryImpact.length > 0 && (
            <div>
              <p className="text-[10px] text-foreground/50 uppercase tracking-wider mb-2">Ангилал бүрийн нөлөөлөл</p>
              <div className="space-y-1.5">
                {result.categoryImpact.map(c => (
                  <div key={c.category} className="flex items-center justify-between px-2 py-1.5 bg-background rounded text-xs">
                    <span className="text-foreground/70 truncate">{c.category}</span>
                    <span className={`font-mono ${c.change > 0 ? "text-green-500" : c.change < 0 ? "text-red-500" : "text-foreground/40"}`}>
                      {c.change > 0 ? "+" : ""}{c.change.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
