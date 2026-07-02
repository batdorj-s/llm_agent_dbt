"use client";

import React, { useEffect, useState } from "react";
import { VisualMessage } from "./VisualMessage";

interface FinanceChart {
  id: string;
  title: string;
  type: string;
  data: { label: string; value: number; value2?: number }[];
  config: Record<string, unknown>;
}

interface FinanceChartsResponse {
  isFinance: boolean;
  tableName?: string;
  charts?: FinanceChart[];
  summary?: {
    totalIncome: number;
    totalExpense: number;
    operatingProfit: number;
  };
}

interface Props {
  token: string;
}

const ChartSkeleton = () => (
  <div className="rounded-xl border border-border/80 bg-card p-5 animate-pulse">
    <div className="h-3 w-1/3 bg-foreground/10 rounded mb-4" />
    <div className="h-48 bg-foreground/5 rounded" />
  </div>
);

export function FinanceDashboard({ token }: Props) {
  const [data, setData] = useState<FinanceChartsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch("/api/finance-charts", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : Promise.resolve({ isFinance: false }))
      .then((json) => { if (!cancelled) { setData(json); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData({ isFinance: false }); setLoading(false); } });

    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider">
          Санхүүгийн хяналтын самбар
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => <ChartSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  if (!data?.isFinance || !data.charts || data.charts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider">
          Санхүүгийн хяналтын самбар
        </span>
        {data.tableName && (
          <span className="text-[10px] text-foreground/30 font-mono">
            [{data.tableName}]
          </span>
        )}
      </div>

      {data.summary && (
        <div className="grid grid-cols-3 gap-3 mb-1">
          {[
            { label: "Нийт орлого", value: data.summary.totalIncome, color: "#3b82f6" },
            { label: "Нийт зарлага", value: data.summary.totalExpense, color: "#ef4444" },
            { label: "ҮА ашиг/алдагдал", value: data.summary.operatingProfit, color: data.summary.operatingProfit >= 0 ? "#10b981" : "#ef4444" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-border/80 bg-card p-4">
              <div className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider mb-1">
                {item.label}
              </div>
              <div className="text-base font-extrabold" style={{ color: item.color }}>
                ₮{Math.round(item.value).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.charts.map((chart) => {
          const visualJson = JSON.stringify({
            title: chart.title,
            type: chart.type,
            data: chart.data,
            config: {
              xAxis: "label",
              yAxis: "value",
              ...chart.config,
            },
          });

          return (
            <div
              key={chart.id}
              className="rounded-xl border border-border/80 bg-card overflow-hidden"
            >
              <VisualMessage visualJson={visualJson} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
