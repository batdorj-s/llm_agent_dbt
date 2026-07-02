"use client";

import React, { useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

interface ChartCardProps {
  title: string;
  /** Ant-design-pro style: colored icon in circle on the left */
  avatar?: React.ReactNode;
  /** Ant-design-pro style: action element (e.g. info tooltip) on the right of title */
  action?: React.ReactNode;
  total?: string | number;
  subTotal?: number;
  status?: "up" | "down";
  children?: React.ReactNode;
  footer?: React.ReactNode;
  contentHeight?: number;
  loading?: boolean;
}

const InfoIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
  </svg>
);

export const ChartCard: React.FC<ChartCardProps> = ({
  title,
  avatar,
  action,
  total,
  subTotal,
  status,
  children,
  footer,
  contentHeight = 60,
  loading = false,
}) => {
  const [tipVisible, setTipVisible] = useState(false);

  const trendIcon =
    status === "up" ? (
      <TrendingUp className="w-3 h-3" />
    ) : status === "down" ? (
      <TrendingDown className="w-3 h-3" />
    ) : null;

  const trendColor =
    status === "up"
      ? "text-emerald-500"
      : status === "down"
        ? "text-red-500"
        : "text-foreground/50";

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm hover:shadow-md transition-shadow duration-150 overflow-hidden">
      {/* Top accent stripe — inspired by ant-design-pro card */}
      <div className="px-5 pt-5 pb-3 flex items-start gap-3">
        {/* Avatar slot */}
        {avatar && (
          <div className="flex-shrink-0">{avatar}</div>
        )}

        <div className="flex-1 min-w-0">
          {/* Title + action row */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider truncate">
              {title}
            </span>
            {/* Action slot — info tooltip */}
            {action ? (
              <div className="flex-shrink-0 relative">
                <button
                  className="text-foreground/30 hover:text-foreground/60 transition-colors"
                  onMouseEnter={() => setTipVisible(true)}
                  onMouseLeave={() => setTipVisible(false)}
                >
                  <InfoIcon />
                </button>
                {tipVisible && (
                  <div className="absolute right-0 top-5 z-50 bg-foreground text-background text-[10px] rounded px-2 py-1 whitespace-nowrap shadow-lg">
                    {action}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Total value */}
          {loading ? (
            <div className="space-y-2 animate-pulse mt-2">
              <div className="h-7 w-24 bg-foreground/10 rounded" />
              <div className="h-3 w-16 bg-foreground/5 rounded" />
            </div>
          ) : (
            total !== undefined && (
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
            )
          )}
        </div>
      </div>

      {/* Chart content area */}
      {!loading && children && (
        <div className="px-5 pb-2 w-full overflow-hidden" style={{ height: contentHeight }}>
          {children}
        </div>
      )}

      {/* Footer */}
      {!loading && footer && (
        <div className="px-5 py-3 border-t border-border/30 bg-foreground/[0.02] text-[11px] text-foreground/50">
          {footer}
        </div>
      )}
    </div>
  );
};
