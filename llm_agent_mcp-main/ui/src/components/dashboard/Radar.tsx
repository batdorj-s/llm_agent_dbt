"use client";

import React from "react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar as RechartsRadar,
  ResponsiveContainer,
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
  { label: "Борлуулалт", value: 85 },
  { label: "Үйлчлүүлэгч", value: 72 },
  { label: "Бүтээмж", value: 90 },
  { label: "Чанар", value: 68 },
  { label: "Инновац", value: 78 },
  { label: "Багийн ажил", value: 82 },
];

export const Radar: React.FC<RadarProps> = ({
  data = defaultData,
  name = "Үзүүлэлт",
  color = "#3b82f6",
  height = 300,
}) => {
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart cx="50%" cy="50%" outerRadius="72%" data={data}>
          <PolarGrid
            stroke="var(--color-border, #e2e8f0)"
            strokeOpacity={0.5}
          />
          <PolarAngleAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--color-foreground)" }}
          />
          <PolarRadiusAxis
            angle={30}
            domain={[0, 100]}
            tick={{ fontSize: 9, fill: "var(--color-foreground)" }}
            axisLine={false}
          />
          <RechartsRadar
            name={name}
            dataKey="value"
            stroke={color}
            fill={color}
            fillOpacity={0.15}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};
