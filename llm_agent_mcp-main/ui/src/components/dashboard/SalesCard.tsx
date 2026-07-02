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
  Cell,
} from "recharts";
import type { DataItem } from "./types";

type TimeType = "today" | "week" | "month" | "year";

interface SalesCardProps {
  loading?: boolean;
  salesData: DataItem[];
  rankingData?: { title: string; total: number }[];
}

const defaultRanking = Array.from({ length: 7 }, (_, i) => ({
  title: `${i + 1}-р салбар`,
  total: Math.floor(Math.random() * 500000) + 50000,
}));

const formatCurrency = (v: number) =>
  `$${v.toLocaleString(undefined, { minimumFractionDigits: 0 })}`;

const CHART_COLORS = {
  sales: ["#5B8FF9", "#85b5fb"],
  views: ["#5AD8A6", "#7ee8bf"],
};

export const SalesCard: React.FC<SalesCardProps> = ({
  loading = false,
  salesData,
  rankingData = defaultRanking,
}) => {
  const [tab, setTab] = useState<"sales" | "views">("sales");
  const [timeRange, setTimeRange] = useState<TimeType>("month");

  const tabs = [
    { key: "sales" as const, label: "Борлуулалт" },
    { key: "views" as const, label: "Хандалт" },
  ];

  const barColor = tab === "sales" ? CHART_COLORS.sales[0] : CHART_COLORS.views[0];
  const barColorLight = tab === "sales" ? CHART_COLORS.sales[1] : CHART_COLORS.views[1];

  if (loading) {
    return (
      <div className="rounded-xl border border-border/80 bg-card p-5 animate-pulse">
        <div className="h-6 w-48 bg-foreground/10 rounded mb-4" />
        <div className="h-[300px] bg-foreground/5 rounded" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/80 bg-card overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/60">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                  tab === t.key
                    ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
                    : "text-foreground/40 hover:text-foreground/70"
                }`}
              >
                {t.label}
              </button>
            ))}
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
            <BarChart data={salesData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
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
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(value) => formatCurrency(Number(value) || 0)}
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  backgroundColor: "var(--color-card)",
                }}
                cursor={{ fill: "var(--color-foreground)", fillOpacity: 0.04 }}
              />
              <Bar
                dataKey="y"
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
                isAnimationActive={true}
              >
                {salesData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={barColor} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Ranking list */}
        <div className="w-full lg:w-72 border-t lg:border-t-0 lg:border-l border-border/60 p-5">
          <h4 className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-4">
            {tab === "sales" ? "Салбарын борлуулалт" : "Салбарын хандалт"}
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
                    background: `linear-gradient(135deg, ${barColor}, ${barColorLight})`,
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
      </div>
    </div>
  );
};
