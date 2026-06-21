"use client";

import React from "react";
import { KpiData } from "./types";

interface DashboardPanelProps {
  salesKpi: KpiData | null;
  usersKpi: KpiData | null;
  churnKpi: KpiData | null;
}

export const DashboardPanel = ({ salesKpi, usersKpi, churnKpi }: DashboardPanelProps) => {
  return (
    <div className="space-y-4">
      <div className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2">Metrics</div>

      <div className="py-2.5 border-b border-border">
        <span className="text-foreground/60 block text-[10px] uppercase font-semibold">Sales Revenue</span>
        <div className="flex justify-between items-baseline mt-0.5">
          <span className="text-sm font-extrabold text-foreground">
            {salesKpi ? `$${salesKpi.current.toLocaleString()}` : "—"}
          </span>
          <span className="text-[10px] text-foreground/50 font-mono">
            Target: {salesKpi ? `$${salesKpi.target.toLocaleString()}` : "—"}
          </span>
        </div>
      </div>

      <div className="py-2.5 border-b border-border">
        <span className="text-foreground/60 block text-[10px] uppercase font-semibold">Active Users</span>
        <div className="flex justify-between items-baseline mt-0.5">
          <span className="text-sm font-extrabold text-foreground">
            {usersKpi ? usersKpi.current.toLocaleString() : "—"}
          </span>
          <span className="text-[10px] text-foreground/50 font-mono">
            Goal: {usersKpi ? usersKpi.target : "—"}
          </span>
        </div>
      </div>

      <div className="py-2.5">
        <span className="text-foreground/60 block text-[10px] uppercase font-semibold">Churn Rate</span>
        <div className="flex justify-between items-baseline mt-0.5">
          <span className={`text-sm font-extrabold ${churnKpi && churnKpi.current > churnKpi.target ? "text-red-500 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
            {churnKpi ? `${churnKpi.current}%` : "—"}
          </span>
          <span className="text-[10px] text-foreground/50 font-mono">
            Limit: {churnKpi ? `${churnKpi.target}%` : "—"}
          </span>
        </div>
      </div>
    </div>
  );
};
