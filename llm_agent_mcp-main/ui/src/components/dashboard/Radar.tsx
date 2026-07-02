"use client";

import React from "react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar as RechartsRadar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface RadarDataItem {
  label: string;
  value: number;
}

interface RadarProps {
  data?: RadarDataItem[];
  name?: string;
  color?: string;
  height?: number;
}

const defaultData: RadarDataItem[] = [
  { label: "Орлогын өсөлт", value: 95 },
  { label: "Зарлагын хяналт", value: 78 },
  { label: "Мөнгөн урсгал", value: 65 },
  { label: "Тогтвортой байдал", value: 40 },
  { label: "Санхүүгийн ашиг", value: 45 },
  { label: "Гүйлгээний идэвх", value: 93 },
];

/* Custom tick that word-wraps long Mongolian labels */
const RadarTick = ({ payload, x, y, textAnchor, cx }: any) => {
  if (!payload?.value) return null;

  const words = String(payload.value).split(/\s+/);
  const lineH = 12;
  // Center multi-line text vertically
  const startY = y - ((words.length - 1) * lineH) / 2;
  // Nudge horizontally away from center to avoid overlap
  const dx = x > (cx ?? 0) ? 2 : x < (cx ?? 0) ? -2 : 0;

  return (
    <g>
      {words.map((word: string, i: number) => (
        <text
          key={i}
          x={x + dx}
          y={startY + i * lineH}
          textAnchor={textAnchor}
          fontSize={9}
          fill="currentColor"
          fillOpacity={0.6}
        >
          {word}
        </text>
      ))}
    </g>
  );
};

const tooltipStyle = {
  backgroundColor: "var(--background)",
  border: "1px solid var(--card-border, #e2e8f0)",
  fontSize: "10px",
  color: "var(--foreground)",
  borderRadius: "6px",
};

export const Radar: React.FC<RadarProps> = ({
  data = defaultData,
  name = "Үзүүлэлт",
  color = "#3b82f6",
  height = 300,
}) => {
  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart
          cx="50%"
          cy="50%"
          /* Smaller outerRadius leaves room for word-wrapped labels */
          outerRadius="52%"
          data={data}
          margin={{ top: 16, right: 32, bottom: 16, left: 32 }}
        >
          <PolarGrid stroke="var(--border, #e2e8f0)" strokeOpacity={0.4} />
          <PolarAngleAxis
            dataKey="label"
            tick={<RadarTick />}
          />
          <PolarRadiusAxis
            angle={30}
            domain={[0, 100]}
            tick={{ fontSize: 8, fill: "currentColor", fillOpacity: 0.4 }}
            axisLine={false}
            tickCount={5}
          />
          <RechartsRadar
            name={name}
            dataKey="value"
            stroke={color}
            fill={color}
            fillOpacity={0.15}
            strokeWidth={2}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: any) => [`${v}`, name]}
          />
        </RadarChart>
      </ResponsiveContainer>

      {/* Score legend row */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 px-2">
        {data.map((item) => (
          <div key={item.label} className="flex items-center justify-between text-[9px]">
            <span className="text-foreground/50 truncate mr-2">{item.label}</span>
            <span
              className="font-bold tabular-nums flex-shrink-0"
              style={{ color: item.value >= 70 ? "#10b981" : item.value >= 40 ? "#f59e0b" : "#ef4444" }}
            >
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
