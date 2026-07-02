"use client";

import React, { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Label } from "recharts";
import type { DataItem } from "./types";

type SalesType = "all" | "online" | "stores";

interface ProportionSalesProps {
  loading?: boolean;
  salesPieData?: DataItem[];
}

const defaultPieData: DataItem[] = [
  { x: "Цалин", y: 77876281 },
  { x: "Төсөл", y: 52607526 },
  { x: "Зээл", y: 42473800 },
  { x: "Бусад", y: 17600000 },
  { x: "Түрээс", y: 11601906 },
  { x: "ҮАЗ", y: 11457856 },
  { x: "Оффис", y: 1357500 },
];

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

const formatCurrency = (v: number) =>
  `₮${v.toLocaleString(undefined, { minimumFractionDigits: 0 })}`;

export const ProportionSales: React.FC<ProportionSalesProps> = ({
  loading = false,
  salesPieData = defaultPieData,
}) => {
  const [salesType, setSalesType] = useState<SalesType>("all");

  const segments = [
    { key: "all" as const, label: "Q1" },
    { key: "online" as const, label: "Зарлага" },
    { key: "stores" as const, label: "Орлого" },
  ];

  if (loading) {
    return (
      <div className="rounded-xl border border-border/80 bg-card p-5 animate-pulse">
        <div className="h-5 w-32 bg-foreground/10 rounded mb-4" />
        <div className="h-[300px] bg-foreground/5 rounded" />
      </div>
    );
  }

  const total = salesPieData.reduce((sum, d) => sum + (d.y as number), 0);

  return (
    <div className="rounded-xl border border-border/80 bg-card p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider">
          Зарлагын бүтэц
        </h3>
        <div className="flex items-center gap-1 bg-foreground/5 rounded-lg p-0.5">
          {segments.map((s) => (
            <button
              key={s.key}
              onClick={() => setSalesType(s.key)}
              className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all cursor-pointer ${
                salesType === s.key
                  ? "bg-foreground text-background"
                  : "text-foreground/50 hover:text-foreground/80"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="text-[11px] text-foreground/50 mb-2">Нийт зарлага</div>

      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={salesPieData}
            cx="50%"
            cy="50%"
            innerRadius="38%"
            outerRadius="62%"
            dataKey="y"
            nameKey="x"
            paddingAngle={2}
          >
            {salesPieData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !("cx" in viewBox)) return null;
                const { cx, cy } = viewBox as { cx: number; cy: number };
                return (
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    <tspan
                      x={cx}
                      dy={-8}
                      style={{
                        fontSize: 16,
                        fontWeight: 800,
                        fill: "var(--color-foreground)",
                      }}
                    >
                      {formatCurrency(total)}
                    </tspan>
                    <tspan
                      x={cx}
                      dy={18}
                      style={{
                        fontSize: 9,
                        fill: "var(--color-foreground, rgba(0,0,0,0.4))",
                        opacity: 0.5,
                      }}
                    >
                      Нийт зарлага
                    </tspan>
                  </text>
                );
              }}
            />
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap justify-center gap-4 mt-2">
        {salesPieData.map((item, i) => (
          <div key={item.x} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="text-[10px] text-foreground/60">{item.x}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
