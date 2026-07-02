"use client";

import React from "react";
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
      {/* Total Sales */}
      <ChartCard
        title="Нийт борлуулалт"
        total={formatCurrency(totalSales)}
        footer={<Field label="Өдрийн борлуулалт" value={formatCurrency(12423)} />}
        contentHeight={72}
        loading={loading}
      >
        <div className="flex gap-4 mt-1 h-full items-center">
          <Trend flag="up">7 хоног <span className="font-bold">12%</span></Trend>
          <Trend flag="down">Өдөр <span className="font-bold">11%</span></Trend>
        </div>
      </ChartCard>

      {/* Visits */}
      <ChartCard
        title="Хандалт"
        total={formatNumber(totalVisits)}
        footer={<Field label="Өдрийн хандалт" value={formatNumber(1234)} />}
        contentHeight={72}
        loading={loading}
      >
        <ResponsiveContainer width="100%" height={72}>
          <AreaChart data={visitData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <Area
              type="monotone"
              dataKey="y"
              stroke="#975FE4"
              strokeWidth={2}
              fill="#975FE4"
              fillOpacity={0.15}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Payments */}
      <ChartCard
        title="Төлбөрийн тоо"
        total={formatNumber(totalPayments)}
        footer={<Field label="Хөрвүүлэлт" value="60%" />}
        contentHeight={72}
        loading={loading}
      >
        <ResponsiveContainer width="100%" height={72}>
          <BarChart data={visitData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <Bar
              dataKey="y"
              fill="#36A2EB"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Campaign Effect */}
      <ChartCard
        title="Үйл ажиллагааны үр дүн"
        total={`${campaignEffect}%`}
        footer={
          <div className="flex gap-4">
            <Trend flag="up">7 хоног <span className="font-bold">12%</span></Trend>
            <Trend flag="down">Өдөр <span className="font-bold">11%</span></Trend>
          </div>
        }
        contentHeight={72}
        loading={loading}
      >
        <div className="w-full h-full flex items-center px-1">
          <div className="w-full">
            <div className="flex justify-between text-[10px] text-foreground/40 mb-1.5">
              <span>0%</span>
              <span>{campaignEffect}%</span>
              <span>100%</span>
            </div>
            <div className="w-full h-2.5 bg-foreground/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${campaignEffect}%`,
                  background: "linear-gradient(90deg, #667eea, #764ba2)",
                }}
              />
            </div>
          </div>
        </div>
      </ChartCard>
    </div>
  );
};
