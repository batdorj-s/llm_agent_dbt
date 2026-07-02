"use client";

import React from "react";

interface GaugeProps {
  percent?: number;
  title?: string;
  color?: string;
  size?: number;
  strokeWidth?: number;
}

export const Gauge: React.FC<GaugeProps> = ({
  percent = 89,
  title = "Орлогын хамрах хувь",
  color = "#3b82f6",
  size = 180,
  strokeWidth = 12,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius;
  const progress = Math.min(Math.max(percent, 0), 100);
  const offset = circumference * (1 - progress / 100);
  const center = size / 2;

  const thresholdColors = [
    { max: 40, color: "#ef4444" },
    { max: 70, color: "#f59e0b" },
    { max: 100, color: "#10b981" },
  ];
  const gaugeColor = thresholdColors.find((t) => progress <= t.max)?.color || color;

  return (
    <div className="flex flex-col items-center gap-3">
      {title && (
        <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider">
          {title}
        </span>
      )}
      <svg width={size} height={size / 2 + strokeWidth} viewBox={`0 0 ${size} ${size / 2 + strokeWidth}`}>
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={gaugeColor} stopOpacity={0.6} />
            <stop offset="100%" stopColor={gaugeColor} />
          </linearGradient>
        </defs>

        <path
          d={`M ${strokeWidth} ${center} A ${radius} ${radius} 0 0 1 ${size - strokeWidth} ${center}`}
          fill="none"
          stroke="var(--color-border, #e2e8f0)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

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

        <text
          x={center}
          y={center - 4}
          textAnchor="middle"
          fill="var(--color-foreground)"
          fontSize={28}
          fontWeight={800}
        >
          {progress}%
        </text>
        <text
          x={center}
          y={center + 18}
          textAnchor="middle"
          fill="var(--color-foreground)"
          opacity={0.4}
          fontSize={10}
        >
          Q1 2026
        </text>
      </svg>
    </div>
  );
};
