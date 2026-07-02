"use client";

import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

interface ChartCardProps {
  title: string;
  total?: string | number;
  subTotal?: number;
  status?: "up" | "down";
  children?: React.ReactNode;
  footer?: React.ReactNode;
  contentHeight?: number;
  loading?: boolean;
}

export const ChartCard: React.FC<ChartCardProps> = ({
  title,
  total,
  subTotal,
  status,
  children,
  footer,
  contentHeight = 60,
  loading = false,
}) => {
  const trendIcon =
    status === "up" ? (
      <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
    ) : status === "down" ? (
      <TrendingDown className="w-3.5 h-3.5 text-red-500" />
    ) : null;

  const trendColor =
    status === "up"
      ? "text-emerald-500"
      : status === "down"
        ? "text-red-500"
        : "text-foreground/50";

  return (
    <div className="rounded-xl border border-border/80 bg-card p-5 flex flex-col gap-3 hover:shadow-md transition-shadow duration-200">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider">
          {title}
        </span>
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-7 w-24 bg-foreground/10 rounded" />
          <div className="h-3 w-16 bg-foreground/5 rounded" />
        </div>
      ) : (
        <>
          {total !== undefined && (
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-foreground tracking-tight">
                {total}
              </span>
              {subTotal !== undefined && (
                <span className={`text-xs font-semibold inline-flex items-center gap-0.5 ${trendColor}`}>
                  {trendIcon}
                  {status === "up" ? "+" : ""}
                  {subTotal}%
                </span>
              )}
            </div>
          )}

          {children && (
            <div
              className="w-full overflow-hidden"
              style={{ height: contentHeight }}
            >
              {children}
            </div>
          )}

          {footer && (
            <div className="border-t border-border/40 pt-3 mt-1 text-[11px] text-foreground/50">
              {footer}
            </div>
          )}
        </>
      )}
    </div>
  );
};
