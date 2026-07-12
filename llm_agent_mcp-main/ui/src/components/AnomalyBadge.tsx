"use client";

import React, { useState, useEffect } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";

interface Anomaly {
  rowIndex: number;
  columnName: string;
  value: number;
  zScore: number;
  method: "z-score" | "iqr";
  row: Record<string, unknown>;
}

interface AnomalyResponse {
  anomalies: Anomaly[];
  columns: string[];
  totalRows: number;
  summary: {
    totalAnomalies: number;
    byColumn: Record<string, number>;
  };
}

interface AnomalyBadgeProps {
  token: string;
  onNavigateToRow?: (rowIndex: number) => void;
}

export function AnomalyBadge({ token, onNavigateToRow }: AnomalyBadgeProps) {
  const [data, setData] = useState<AnomalyResponse | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const fetchAnomalies = async () => {
    if (hasLoaded) {
      setIsExpanded(!isExpanded);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/kpi/anomalies?limit=1000", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      setData(result);
      setHasLoaded(true);
      setIsExpanded(true);
    } catch {
      // best-effort
    } finally {
      setIsLoading(false);
    }
  };

  const totalAnomalies = data?.summary?.totalAnomalies ?? 0;

  return (
    <div className="relative">
      {/* Badge Button */}
      <button onClick={fetchAnomalies} disabled={isLoading}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-all cursor-pointer ${
          totalAnomalies > 0
            ? "border-red-500/30 bg-red-500/5 text-red-500 hover:bg-red-500/10"
            : "border-border bg-card text-foreground/60 hover:bg-foreground/5"
        } ${isLoading ? "opacity-50" : ""}`}>
        <AlertTriangle className="w-3.5 h-3.5" />
        {totalAnomalies > 0 ? (
          <span>{totalAnomalies} хэвийн бус утга</span>
        ) : (
          <span>Аномали шалгах</span>
        )}
        {hasLoaded && (
          isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
        )}
      </button>

      {/* Expanded Panel */}
      {isExpanded && data && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/50">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-xs font-medium">Аномалиуд ({data.anomalies.length})</span>
            </div>
            <button onClick={() => setIsExpanded(false)} className="text-foreground/40 hover:text-foreground/80 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Summary */}
          {data.summary && Object.keys(data.summary.byColumn).length > 0 && (
            <div className="px-4 py-2 border-b border-border/50 bg-background/30">
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.summary.byColumn).map(([col, count]) => (
                  <span key={col} className="px-2 py-0.5 text-[10px] bg-red-500/10 text-red-500 rounded-full">
                    {col}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Table */}
          <div className="max-h-64 overflow-y-auto scrollbar-hide">
            {data.anomalies.length === 0 ? (
              <div className="p-6 text-center text-foreground/40 text-xs">
                Хэвийн бус утга олдсонгүй
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background/90 backdrop-blur-sm">
                  <tr className="border-b border-border/50">
                    <th className="px-3 py-2 text-left text-foreground/50 font-medium">Мөр</th>
                    <th className="px-3 py-2 text-left text-foreground/50 font-medium">Багана</th>
                    <th className="px-3 py-2 text-left text-foreground/50 font-medium">Утга</th>
                    <th className="px-3 py-2 text-left text-foreground/50 font-medium">Z-score</th>
                    <th className="px-3 py-2 text-left text-foreground/50 font-medium">Арга</th>
                  </tr>
                </thead>
                <tbody>
                  {data.anomalies.slice(0, 30).map((a, i) => (
                    <tr key={i} onClick={() => onNavigateToRow?.(a.rowIndex)}
                      className="border-b border-border/30 hover:bg-foreground/5 cursor-pointer transition-colors">
                      <td className="px-3 py-1.5 text-foreground/60">#{a.rowIndex + 1}</td>
                      <td className="px-3 py-1.5">
                        <span className="px-1.5 py-0.5 bg-red-500/10 text-red-500 rounded text-[10px]">
                          {a.columnName}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-foreground/80 font-mono">
                        {typeof a.value === "number" ? a.value.toLocaleString() : String(a.value)}
                      </td>
                      <td className="px-3 py-1.5 font-mono">
                        <span className={`${a.zScore > 5 ? "text-red-600" : a.zScore > 3 ? "text-red-500" : "text-amber-500"}`}>
                          {a.zScore}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          a.method === "z-score"
                            ? "bg-blue-500/10 text-blue-500"
                            : "bg-purple-500/10 text-purple-500"
                        }`}>
                          {a.method}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {data.anomalies.length > 30 && (
            <div className="px-4 py-2 text-center text-[10px] text-foreground/40 border-t border-border/50">
              +{data.anomalies.length - 30} илүү аномали
            </div>
          )}
        </div>
      )}
    </div>
  );
}
