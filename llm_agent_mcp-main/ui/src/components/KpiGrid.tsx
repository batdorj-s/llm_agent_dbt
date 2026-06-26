"use client";

import React from "react";
import { KpiData, ComputedMetrics } from "./types";
import { chartTheme } from "./chartTheme";

interface KpiGridProps {
  salesKpi: KpiData | null;
  usersKpi: KpiData | null;
  churnKpi: KpiData | null;
  computedMetrics: ComputedMetrics | null;
  isLoading?: boolean;
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

function KpiCard({
  label,
  value,
  subLabel,
  subValue,
  color,
  trend,
}: {
  label: string;
  value: string;
  subLabel: string;
  subValue: string;
  color: string;
  trend?: { direction: "up" | "down"; label: string };
}) {
  return (
    <div className="border border-border/80 rounded-xl p-4 bg-card shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col gap-1.5">
      <span className="text-[10px] text-foreground/50 uppercase font-semibold tracking-wider">{label}</span>
      <span className="text-lg font-extrabold text-foreground" style={{ color }}>
        {value}
      </span>
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

export const KpiGrid = ({ salesKpi, usersKpi, churnKpi, computedMetrics, isLoading }: KpiGridProps) => {
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
      <KpiCard
        label="Sales Revenue"
        value={salesKpi ? `$${salesKpi.current.toLocaleString()}` : "—"}
        subLabel="Target"
        subValue={salesKpi ? `$${salesKpi.target.toLocaleString()}` : "—"}
        color={chartTheme.colors.semantic.bar}
      />
      <KpiCard
        label="Active Users"
        value={usersKpi ? usersKpi.current.toLocaleString() : "—"}
        subLabel="Goal"
        subValue={usersKpi ? usersKpi.target.toLocaleString() : "—"}
        color={chartTheme.colors.semantic.line}
      />
      <KpiCard
        label="Churn Rate"
        value={churnKpi ? `${churnKpi.current}%` : "—"}
        subLabel="Limit"
        subValue={churnKpi ? `${churnKpi.target}%` : "—"}
        color={churnColor}
      />
      <KpiCard
        label="Average Order Value"
        value={aov !== null ? `${aov.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
        subLabel="Top Category"
        subValue={topCategory !== null && aov !== null ? topCategory : "—"}
        color={chartTheme.colors.semantic.area}
        trend={growthRate !== null ? { direction: growthDirection, label: `${Math.abs(growthRate).toFixed(1)}%` } : undefined}
      />
    </div>
  );
};
