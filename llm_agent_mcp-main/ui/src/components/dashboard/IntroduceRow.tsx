"use client";

import React from "react";
import { AreaChart, Area, BarChart, Bar, ResponsiveContainer } from "recharts";
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

const defaultVisitData: DataItem[] = [
  { x: "1-р сар", y: 41797000 },
  { x: "2-р сар", y: 56550000 },
  { x: "3-р сар", y: 92277000 },
];

/* Ant-design-pro style avatar icons */
const AvatarSales = () => (
  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-50 text-blue-500">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  </div>
);

const AvatarCustomer = () => (
  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-purple-50 text-purple-500">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  </div>
);

const AvatarTxn = () => (
  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-cyan-50 text-cyan-500">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  </div>
);

const AvatarRate = () => (
  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-emerald-50 text-emerald-500">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  </div>
);

export const IntroduceRow: React.FC<IntroduceRowProps> = ({
  loading = false,
  visitData = defaultVisitData,
  totalSales = 190624000,
  totalVisits = 4,
  totalPayments = 186,
  campaignEffect = 89,
}) => {
  const fmtCurrency = (v: number) => `₮${v.toLocaleString(undefined, { minimumFractionDigits: 0 })}`;
  const fmtNum = (v: number) => v.toLocaleString();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Нийт орлого */}
      <ChartCard
        title="Нийт орлого"
        avatar={<AvatarSales />}
        action="Q1 2024 нийт орлого"
        total={fmtCurrency(totalSales)}
        footer={<Field label="Дундаж сарын орлого" value={fmtCurrency(63541333)} />}
        contentHeight={72}
        loading={loading}
      >
        <div className="flex gap-4 mt-1 h-full items-center">
          <Trend flag="up">1→3-р сар <span className="font-bold">+121%</span></Trend>
          <Trend flag="down">Q1 алдагдал <span className="font-bold">₮24M</span></Trend>
        </div>
      </ChartCard>

      {/* Харилцагч */}
      <ChartCard
        title="Орлогын харилцагч"
        avatar={<AvatarCustomer />}
        action="Орлоготой харилцагчдын тоо"
        total={fmtNum(totalVisits)}
        footer={<Field label="Гол харилцагч" value="ВАЙРАЛ ПИКСЕЛЬ" />}
        contentHeight={72}
        loading={loading}
      >
        <ResponsiveContainer width="100%" height={72}>
          <AreaChart data={visitData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="introAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#975FE4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#975FE4" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="y" stroke="#975FE4" strokeWidth={2} fill="url(#introAreaGrad)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Гүйлгээ */}
      <ChartCard
        title="Гүйлгээний тоо"
        avatar={<AvatarTxn />}
        action="Нийт орлого + зарлага гүйлгээ"
        total={fmtNum(totalPayments)}
        footer={<Field label="Орлого/зарлага харьцаа" value="88.7%" />}
        contentHeight={72}
        loading={loading}
      >
        <ResponsiveContainer width="100%" height={72}>
          <BarChart data={visitData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <Bar dataKey="y" fill="#36A2EB" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Хамрах хувь — ant-design-pro Progress style gradient bar */}
      <ChartCard
        title="Орлогын хамрах хувь"
        avatar={<AvatarRate />}
        action="Нийт орлогын зорилтын гүйцэтгэл"
        total={`${campaignEffect}%`}
        footer={
          <div className="flex gap-4">
            <Trend flag="up">3-р сар <span className="font-bold">+63%</span></Trend>
            <Trend flag="down">Q1 алдагдал <span className="font-bold">₮24M</span></Trend>
          </div>
        }
        contentHeight={72}
        loading={loading}
      >
        <div className="w-full h-full flex items-center px-1">
          <div className="w-full">
            <div className="flex justify-between text-[10px] text-foreground/40 mb-1.5">
              <span>0%</span>
              <span className="font-semibold text-foreground/60">{campaignEffect}%</span>
              <span>100%</span>
            </div>
            {/* Ant-design-pro strokeColor gradient progress */}
            <div className="w-full h-2 bg-foreground/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${campaignEffect}%`,
                  background: "linear-gradient(90deg, #108ee9 0%, #87d068 100%)",
                }}
              />
            </div>
            <div className="mt-1.5 text-[9px] text-foreground/40 text-right">{100 - campaignEffect}% үлдсэн</div>
          </div>
        </div>
      </ChartCard>
    </div>
  );
};
