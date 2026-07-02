"use client";

import React from "react";

interface GaugeProps {
  percent?: number;
  title?: string;
  color?: string;
  size?: number;
  strokeWidth?: number;
  /** Optional label shown below the percent (e.g. "200M зорилгоос") */
  subLabel?: string;
}

export const Gauge: React.FC<GaugeProps> = ({
  percent = 89,
  title = "Орлогын гүйцэтгэл",
  color = "#3b82f6",
  size = 180,
  strokeWidth = 12,
  subLabel,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius;
  const progress = Math.min(Math.max(percent, 0), 100);
  const offset = circumference * (1 - progress / 100);
  const center = size / 2;

  const gaugeColor =
    progress >= 80 ? "#10b981" :
    progress >= 50 ? "#f59e0b" :
    "#ef4444";

  return (
    <div className="flex flex-col items-center gap-2">
      {title && (
        <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider text-center">
          {title}
        </span>
      )}
      <svg width={size} height={size / 2 + strokeWidth + 4} viewBox={`0 0 ${size} ${size / 2 + strokeWidth + 4}`}>
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={gaugeColor} stopOpacity={0.5} />
            <stop offset="100%" stopColor={gaugeColor} />
          </linearGradient>
        </defs>

        {/* Track */}
        <path
          d={`M ${strokeWidth} ${center} A ${radius} ${radius} 0 0 1 ${size - strokeWidth} ${center}`}
          fill="none"
          stroke="var(--border, #e2e8f0)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Progress */}
        <path
          d={`M ${strokeWidth} ${center} A ${radius} ${radius} 0 0 1 ${size - strokeWidth} ${center}`}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />

        {/* Center value */}
        <text
          x={center}
          y={center - 6}
          textAnchor="middle"
          fill={gaugeColor}
          fontSize={30}
          fontWeight={800}
          fontFamily="inherit"
        >
          {progress}%
        </text>

        {/* Sub label */}
        <text
          x={center}
          y={center + 16}
          textAnchor="middle"
          fill="currentColor"
          opacity={0.35}
          fontSize={9}
          fontFamily="inherit"
        >
          {subLabel ?? "200M зорилгоос"}
        </text>

        {/* Scale ticks */}
        <text x={strokeWidth - 2} y={center + 18} textAnchor="middle" fontSize={8} fill="currentColor" opacity={0.3}>0</text>
        <text x={size - strokeWidth + 2} y={center + 18} textAnchor="middle" fontSize={8} fill="currentColor" opacity={0.3}>100</text>
      </svg>
    </div>
  );
};
