"use client";

import React, { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { NumberInfo } from "./NumberInfo";
interface ChartPoint {
  date: string;
  type: string;
  value: number;
  [key: string]: string | number | undefined;
}

interface OfflineStore {
  name: string;
  cvr: number;
}

interface OfflineDataProps {
  loading?: boolean;
  offlineData?: OfflineStore[];
  offlineChartData?: ChartPoint[];
}

const defaultStores: OfflineStore[] = [
  { name: "Төв салбар", cvr: 0.72 },
  { name: "Баруун салбар", cvr: 0.65 },
  { name: "Зүүн салбар", cvr: 0.58 },
  { name: "Хойд салбар", cvr: 0.81 },
  { name: "Өмнөд салбар", cvr: 0.45 },
];

function generateChartData(stores: OfflineStore[]): ChartPoint[] {
  return stores.flatMap((store) =>
    Array.from({ length: 30 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      type: store.name,
      value: Math.floor(Math.random() * 200) + 50,
    }))
  );
}

const defaultChartData = generateChartData(defaultStores);

const ringGradientId = "offlineRingGrad";

export const OfflineData: React.FC<OfflineDataProps> = ({
  loading = false,
  offlineData = defaultStores,
  offlineChartData = defaultChartData,
}) => {
  const [activeKey, setActiveKey] = useState(offlineData[0]?.name);

  if (loading) {
    return (
      <div className="rounded-xl border border-border/80 bg-card p-5 animate-pulse">
        <div className="h-8 bg-foreground/10 rounded mb-4" />
        <div className="h-[400px] bg-foreground/5 rounded" />
      </div>
    );
  }

  const currentStore = offlineData.find((s) => s.name === activeKey) || offlineData[0];

  const filteredData = offlineChartData.filter((d) => d.type === (currentStore?.name ?? ""));

  return (
    <div className="rounded-xl border border-border/80 bg-card overflow-hidden">
      <div className="flex flex-wrap gap-1 p-4 border-b border-border/40">
        {offlineData.map((store, i) => {
          const colors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
          const color = colors[i % colors.length];
          const ringPercent = store.cvr;
          const ringCircumference = 2 * Math.PI * 22;
          const ringOffset = ringCircumference * (1 - ringPercent);

          return (
            <button
              key={store.name}
              onClick={() => setActiveKey(store.name)}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all cursor-pointer border-none text-left ${
                activeKey === store.name
                  ? "bg-foreground/5 ring-1 ring-foreground/10"
                  : "hover:bg-foreground/5"
              }`}
            >
              <div className="flex flex-col min-w-0">
                <NumberInfo
                  title={store.name}
                  total={`${(store.cvr * 100).toFixed(0)}%`}
                  subTitle="Хөрвүүлэлт"
                  gap={2}
                />
              </div>
              <svg width={50} height={50} viewBox="0 0 50 50" className="shrink-0">
                <defs>
                  <linearGradient id={`${ringGradientId}${i}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={color} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <circle
                  cx={25}
                  cy={25}
                  r={22}
                  fill="none"
                  stroke="var(--color-border, #e2e8f0)"
                  strokeWidth={4}
                />
                <circle
                  cx={25}
                  cy={25}
                  r={22}
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
                  x={25}
                  y={25}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--color-foreground)"
                  fontSize={10}
                  fontWeight={700}
                >
                  {(store.cvr * 100).toFixed(0)}
                </text>
              </svg>
            </button>
          );
        })}
      </div>

      <div className="p-6">
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={filteredData}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border, #e2e8f0)"
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "var(--color-foreground)" }}
              tickFormatter={(v) => v.slice(5)}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--color-foreground)" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                fontSize: 11,
                borderRadius: 8,
                border: "1px solid var(--color-border)",
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              name={currentStore?.name || "Салбар"}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
