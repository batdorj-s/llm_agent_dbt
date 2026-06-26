"use client";

import React from "react";
import { KpiData, ComputedMetrics, SalesHistory } from "./types";
import { chartTheme } from "./chartTheme";
import { ResponsiveContainer, LineChart, Line } from "recharts";

interface KpiGridProps {
  salesKpi: KpiData | null;
  usersKpi: KpiData | null;
  churnKpi: KpiData | null;
  computedMetrics: ComputedMetrics | null;
  salesHistory?: SalesHistory[];
  isLoading?: boolean;
}

function Sparkline({ data, dataKey, color }: { data: { month: string; revenue: number }[]; dataKey: string; color: string }) {
  if (data.length === 0) return null;
  return (
    <div className="h-8 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <defs>
            <linearGradient id={`sparkGrad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="border border-border/80 rounded-xl p-4 bg-card shadow-sm animate-pulse flex flex-col gap-3">
      <div className="h-2.5 bg-foreground/10 rounded w-1/2" />
      <div className="h-6 bg-foreground/10 rounded w-2/3" />
      <div className="flex justify-between">
        <div className="h-2 bg-foreground/10 rounded w-1/3" />
        <div className="h-2 bg-foreground/10 rounded w-1/5" />
      </div>
    </div>
  );
}

function ProgressBar({ value, max, invert, color }: { value: number; max: number; invert?: boolean; color?: string }) {
  if (max <= 0) return null;
  const ratio = Math.min(value / max, 1);
  const pct = Math.round(ratio * 100);
  const isGood = invert ? value <= max : value >= max;
  const fillColor = color || (isGood ? "#10b981" : "#ef4444");
  return (
    <div className="h-1.5 w-full bg-foreground/10 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{ width: `${pct}%`, backgroundColor: fillColor }}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  subLabel,
  subValue,
  color,
  trend,
  sparkline,
  progress,
}: {
  label: string;
  value: string;
  subLabel: string;
  subValue: string;
  color: string;
  trend?: { direction: "up" | "down"; label: string };
  sparkline?: React.ReactNode;
  progress?: { current: number; target: number; invert?: boolean };
}) {
  return (
    <div className="border border-border/80 rounded-xl p-4 bg-card shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col gap-1.5">
      <span className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">{label}</span>
      <span className="text-lg font-extrabold text-foreground" style={{ color }}>
        {value}
      </span>
      {sparkline}
      {progress && <ProgressBar value={progress.current} max={progress.target} invert={progress.invert} />}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-foreground/50">{subLabel}: <span className="text-foreground/80 font-mono">{subValue}</span></span>
        {trend && (
          <span className={`font-bold font-mono ${trend.direction === "up" ? "text-emerald-500" : "text-red-500"}`}>
            {trend.direction === "up" ? "▲" : "▼"} {trend.label}
          </span>
        )}
      </div>
    </div>
  );
}

export const KpiGrid = ({ salesKpi, usersKpi, churnKpi, computedMetrics, salesHistory, isLoading }: KpiGridProps) => {
  const churnColor = churnKpi && churnKpi.current > churnKpi.target
    ? "#ef4444" : "#10b981";

  const aov = computedMetrics?.aov ?? null;
  const growthRate = computedMetrics?.growthRate ?? null;
  const topCategory = computedMetrics?.topCategory ?? null;
  const growthDirection = computedMetrics?.growthDirection ?? "up";

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {[
        <KpiCard key="sales"
          label="Sales Revenue"
          value={salesKpi ? `$${salesKpi.current.toLocaleString()}` : "—"}
          subLabel="Target"
          subValue={salesKpi ? `$${salesKpi.target.toLocaleString()}` : "—"}
          color={chartTheme.colors.semantic.bar}
          sparkline={salesHistory && salesHistory.length > 0 ? (
            <Sparkline data={salesHistory} dataKey="revenue" color={chartTheme.colors.semantic.bar} />
          ) : undefined}
          progress={salesKpi ? { current: salesKpi.current, target: salesKpi.target } : undefined}
        />,
        <KpiCard key="users"
          label="Active Users"
          value={usersKpi ? usersKpi.current.toLocaleString() : "—"}
          subLabel="Goal"
          subValue={usersKpi ? usersKpi.target.toLocaleString() : "—"}
          color={chartTheme.colors.semantic.line}
          progress={usersKpi ? { current: usersKpi.current, target: usersKpi.target } : undefined}
        />,
        <KpiCard key="churn"
          label="Churn Rate"
          value={churnKpi ? `${churnKpi.current}%` : "—"}
          subLabel="Limit"
          subValue={churnKpi ? `${churnKpi.target}%` : "—"}
          color={churnColor}
          progress={churnKpi ? { current: churnKpi.current, target: churnKpi.target, invert: true } : undefined}
        />,
        <KpiCard key="aov"
          label="Average Order Value"
          value={aov !== null ? `${aov.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
          subLabel="Top Category"
          subValue={topCategory !== null && aov !== null ? topCategory : "—"}
          color={chartTheme.colors.semantic.area}
          trend={growthRate !== null ? { direction: growthDirection, label: `${Math.abs(growthRate).toFixed(1)}%` } : undefined}
        />,
      ].map((card, i) => (
        <div key={card.key} className="animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
          {card}
        </div>
      ))}
    </div>
  );
};
