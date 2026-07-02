"use client";

import React, { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ExpenseCategory {
  name: string;
  share: number;
  color: string;
}

interface OfflineDataProps {
  loading?: boolean;
  categories?: ExpenseCategory[];
  monthlyExpenses?: Record<string, { month: string; amount: number }[]>;
}

const defaultCategories: ExpenseCategory[] = [
  { name: "Цалин", share: 0.362, color: "#3b82f6" },
  { name: "Төсөл", share: 0.245, color: "#10b981" },
  { name: "Зээл", share: 0.198, color: "#f59e0b" },
  { name: "Бусад", share: 0.082, color: "#8b5cf6" },
  { name: "Түрээс", share: 0.054, color: "#ec4899" },
  { name: "ҮАЗ", share: 0.053, color: "#ef4444" },
  { name: "Оффис", share: 0.006, color: "#14b8a6" },
];

const monthlyExpenses: Record<string, { month: string; amount: number }[]> = {
  "Цалин": [
    { month: "1-р сар", amount: 27000000 },
    { month: "2-р сар", amount: 20000000 },
    { month: "3-р сар", amount: 30876281 },
  ],
  "Төсөл": [
    { month: "1-р сар", amount: 18000000 },
    { month: "2-р сар", amount: 14000000 },
    { month: "3-р сар", amount: 20607526 },
  ],
  "Зээл": [
    { month: "1-р сар", amount: 14157933 },
    { month: "2-р сар", amount: 14157933 },
    { month: "3-р сар", amount: 14157934 },
  ],
  "Бусад": [
    { month: "1-р сар", amount: 7000000 },
    { month: "2-р сар", amount: 5000000 },
    { month: "3-р сар", amount: 5600000 },
  ],
  "Түрээс": [
    { month: "1-р сар", amount: 3867302 },
    { month: "2-р сар", amount: 3867302 },
    { month: "3-р сар", amount: 3867302 },
  ],
  "ҮАЗ": [
    { month: "1-р сар", amount: 5000000 },
    { month: "2-р сар", amount: 2000000 },
    { month: "3-р сар", amount: 4457856 },
  ],
  "Оффис": [
    { month: "1-р сар", amount: 452500 },
    { month: "2-р сар", amount: 452500 },
    { month: "3-р сар", amount: 452500 },
  ],
};

const ringGradientId = "offlineRingGrad";

const formatM = (v: number) => `₮${(v / 1_000_000).toFixed(1)}M`;

export const OfflineData: React.FC<OfflineDataProps> = ({
  loading = false,
  categories: activeCategories = defaultCategories,
  monthlyExpenses: activeMonthlyExpenses = monthlyExpenses,
}) => {
  const [activeKey, setActiveKey] = useState(activeCategories[0].name);

  useEffect(() => {
    if (activeCategories.length > 0 && !activeCategories.find(c => c.name === activeKey)) {
      setActiveKey(activeCategories[0].name);
    }
  }, [activeCategories, activeKey]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border/80 bg-card p-5 animate-pulse">
        <div className="h-8 bg-foreground/10 rounded mb-4" />
        <div className="h-[300px] bg-foreground/5 rounded" />
      </div>
    );
  }

  const currentCategory = activeCategories.find((c) => c.name === activeKey) ?? activeCategories[0];
  const chartData = activeMonthlyExpenses[activeKey] ?? [];

  return (
    <div className="rounded-xl border border-border/80 bg-card overflow-hidden">
      <div className="flex flex-wrap gap-1 p-4 border-b border-border/40">
        {activeCategories.map((cat, i) => {
          const ringCircumference = 2 * Math.PI * 22;
          const ringOffset = ringCircumference * (1 - cat.share);

          return (
            <button
              key={cat.name}
              onClick={() => setActiveKey(cat.name)}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all cursor-pointer border-none text-left ${
                activeKey === cat.name
                  ? "bg-foreground/5 ring-1 ring-foreground/10"
                  : "hover:bg-foreground/5"
              }`}
            >
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-semibold text-foreground/80 leading-tight">{cat.name}</span>
                <span className="text-[9px] text-foreground/40 leading-tight">Зарлагын хувь</span>
                <span className="text-xs font-bold leading-tight" style={{ color: cat.color }}>
                  {(cat.share * 100).toFixed(1)}%
                </span>
              </div>
              <svg width={46} height={46} viewBox="0 0 50 50" className="shrink-0">
                <defs>
                  <linearGradient id={`${ringGradientId}${i}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={cat.color} />
                    <stop offset="100%" stopColor={cat.color} stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <circle
                  cx={25} cy={25} r={22}
                  fill="none"
                  stroke="var(--color-border, #e2e8f0)"
                  strokeWidth={4}
                />
                <circle
                  cx={25} cy={25} r={22}
                  fill="none"
                  stroke={`url(#${ringGradientId}${i})`}
                  strokeWidth={4}
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset}
                  strokeLinecap="round"
                  transform="rotate(-90 25 25)"
                  style={{ transition: "stroke-dashoffset 0.5s ease" }}
                />
                <text
                  x={25} y={25}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--color-foreground)"
                  fontSize={9}
                  fontWeight={700}
                >
                  {(cat.share * 100).toFixed(0)}%
                </text>
              </svg>
            </button>
          );
        })}
      </div>

      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider">
            {currentCategory.name} — Сарын зарлага
          </span>
          <span className="text-[10px] font-mono text-foreground/40">
            Q1 нийт: {formatM(activeMonthlyExpenses[activeKey]?.reduce((s, d) => s + d.amount, 0) ?? 0)}
          </span>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border, #e2e8f0)"
              vertical={false}
              strokeOpacity={0.6}
            />
            <XAxis
              dataKey="month"
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
              formatter={(value) => [formatM(Number(value)), currentCategory.name]}
              contentStyle={{
                fontSize: 11,
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-card)",
              }}
              cursor={{ fill: "var(--color-foreground)", fillOpacity: 0.04 }}
            />
            <Bar
              dataKey="amount"
              fill={currentCategory.color}
              fillOpacity={0.85}
              radius={[4, 4, 0, 0]}
              maxBarSize={48}
              name={currentCategory.name}
              isAnimationActive={true}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
