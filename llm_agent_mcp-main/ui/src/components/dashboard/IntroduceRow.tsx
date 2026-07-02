"use client";

import React from "react";
import { Info } from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "./ChartCard";
import { Trend } from "./Trend";
import { Field } from "./Field";
import type { DataItem } from "./types";

interface IntroduceRowProps {
  loading?: boolean;
  visitData?: DataItem[];
  totalSales?: number;
  totalVisits?: number;
  totalPayments?: number;
  campaignEffect?: number;
}

const defaultVisitData: DataItem[] = Array.from({ length: 7 }, (_, i) => ({
  x: `Day ${i + 1}`,
  y: Math.floor(Math.random() * 80) + 20,
}));

export const IntroduceRow: React.FC<IntroduceRowProps> = ({
  loading = false,
  visitData = defaultVisitData,
  totalSales = 126560,
  totalVisits = 8846,
  totalPayments = 6560,
  campaignEffect = 78,
}) => {
  const formatCurrency = (v: number) =>
    `$${v.toLocaleString(undefined, { minimumFractionDigits: 0 })}`;

  const formatNumber = (v: number) => v.toLocaleString();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <ChartCard
        title="Нийт борлуулалт"
        total={formatCurrency(totalSales)}
        footer={<Field label="Өдрийн борлуулалт" value={formatCurrency(12423)} />}
        contentHeight={46}
        loading={loading}
      >
        <div className="flex gap-4 mt-1">
          <Trend flag="up">7 хоног <span className="font-bold">12%</span></Trend>
          <Trend flag="down">Өдөр <span className="font-bold">11%</span></Trend>
        </div>
      </ChartCard>

      <ChartCard
        title="Хандалт"
        total={formatNumber(totalVisits)}
        footer={<Field label="Өдрийн хандалт" value={formatNumber(1234)} />}
        contentHeight={46}
        loading={loading}
      >
        <ResponsiveContainer width="100%" height={46}>
          <AreaChart data={visitData}>
            <defs>
              <linearGradient id="visitGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="white" stopOpacity={0.01} />
                <stop offset="100%" stopColor="#975FE4" stopOpacity={0.6} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="y"
              stroke="#975FE4"
              strokeWidth={1.5}
              fill="url(#visitGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Төлбөрийн тоо"
        total={formatNumber(totalPayments)}
        footer={<Field label="Хөрвүүлэлт" value="60%" />}
        contentHeight={46}
        loading={loading}
      >
        <ResponsiveContainer width="100%" height={46}>
          <BarChart data={visitData}>
            <Bar dataKey="y" fill="#f59e0b" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Үйл ажиллагааны үр дүн"
        total={`${campaignEffect}%`}
        footer={
          <div className="flex gap-4">
            <Trend flag="up">7 хоног <span className="font-bold">12%</span></Trend>
            <Trend flag="down">Өдөр <span className="font-bold">11%</span></Trend>
          </div>
        }
        contentHeight={46}
        loading={loading}
      >
        <div className="w-full h-full flex items-center">
          <div className="w-full h-2 bg-foreground/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${campaignEffect}%`,
                background: "linear-gradient(90deg, #3b82f6, #10b981)",
              }}
            />
          </div>
        </div>
      </ChartCard>
    </div>
  );
};
