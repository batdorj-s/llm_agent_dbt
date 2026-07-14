"use client";

import React, { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DataItem } from "./types";

type TimeType = "today" | "week" | "month" | "year";

interface SalesCardProps {
  loading?: boolean;
  salesData?: DataItem[];
  expenseData?: DataItem[];
  rankingData?: { title: string; total: number }[];
}

const formatCurrency = (v: number) =>
  `₮${v.toLocaleString(undefined, { minimumFractionDigits: 0 })}`;

export const SalesCard: React.FC<SalesCardProps> = ({
  loading = false,
  salesData,
  expenseData,
  rankingData,
}) => {
  const [timeRange, setTimeRange] = useState<TimeType>("month");

  if (loading) {
    return (
      <div className="rounded-xl border border-border/80 bg-card p-5 animate-pulse">
        <div className="h-6 w-48 bg-foreground/10 rounded mb-4" />
        <div className="h-[300px] bg-foreground/5 rounded" />
      </div>
    );
  }

  const chartData = (salesData ?? []).map((s, i) => ({
    x: s.x,
    income: s.y,
    expense: (expenseData ?? [])[i]?.y ?? 0,
  }));

  if (chartData.length === 0 && (!rankingData || rankingData.length === 0)) {
    return (
      <div className="rounded-xl border border-border/80 bg-card p-5">
        <h3 className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-4">
          Орлого / Зарлага
        </h3>
        <div className="flex items-center justify-center h-64 text-[11px] text-foreground/40">
          Өгөгдөл байхгүй
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/80 bg-card overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/60">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-4">
            <h3 className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider">
              Орлого / Зарлага
            </h3>
            <div className="flex items-center gap-3 text-[10px] text-foreground/50">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm inline-block bg-emerald-500" />
                Орлого
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm inline-block bg-red-400" />
                Зарлага
              </span>
            </div>
          </div>
          <div className="flex items-center text-[11px] font-medium border border-border/60 rounded-lg overflow-hidden">
            {(["today", "week", "month", "year"] as TimeType[]).map((k) => (
              <button
                key={k}
                onClick={() => setTimeRange(k)}
                className={`px-2.5 py-1 transition-colors cursor-pointer ${
                  timeRange === k
                    ? "bg-foreground/10 text-foreground font-bold"
                    : "text-foreground/40 hover:text-foreground/70"
                }`}
              >
                {k === "today"
                  ? "Өнөөдөр"
                  : k === "week"
                    ? "7 хоног"
                    : k === "month"
                      ? "Сар"
                      : "Жил"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart + Ranking */}
      <div className="flex flex-col lg:flex-row">
        <div className="flex-1 p-5">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border, #e2e8f0)"
                vertical={false}
                strokeOpacity={0.6}
              />
              <XAxis
                dataKey="x"
                tick={{ fontSize: 10, fill: "var(--color-foreground)" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--color-foreground)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`}
              />
              <Tooltip
                formatter={(value, name) => [
                  formatCurrency(Number(value) || 0),
                  name === "income" ? "Орлого" : "Зарлага",
                ]}
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  backgroundColor: "var(--color-card)",
                }}
                cursor={{ fill: "var(--color-foreground)", fillOpacity: 0.04 }}
              />
              <Bar
                dataKey="income"
                fill="#10b981"
                fillOpacity={0.85}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
                name="Орлого"
                isAnimationActive={true}
              />
              <Bar
                dataKey="expense"
                fill="#ef4444"
                fillOpacity={0.85}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
                name="Зарлага"
                isAnimationActive={true}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Ranking list */}
        {rankingData && rankingData.length > 0 && (
          <div className="w-full lg:w-72 border-t lg:border-t-0 lg:border-l border-border/60 p-5">
            <h4 className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-4">
              Зарлагын ангилал
            </h4>
            <ul className="space-y-3">
              {rankingData.map((item, i) => (
                <li key={item.title} className="flex items-center gap-3 group">
                  <span
                    className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 transition-transform group-hover:scale-110 ${
                      i < 3
                        ? "text-white"
                        : "bg-foreground/5 text-foreground/40"
                    }`}
                    style={i < 3 ? {
                      background: "linear-gradient(135deg, #ef4444, #f87171)",
                    } : {}}
                  >
                    {i + 1}
                  </span>
                  <span
                    className="flex-1 text-xs text-foreground/70 truncate"
                    title={item.title}
                  >
                    {item.title}
                  </span>
                  <span className="text-xs font-semibold text-foreground/80 font-mono">
                    {formatCurrency(item.total)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
