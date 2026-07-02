"use client";

import React from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
} from "recharts";
import { Info } from "lucide-react";
import { NumberInfo } from "./NumberInfo";
import { Trend } from "./Trend";
import type { DataItem, SearchDataItem } from "./types";

interface TopSearchProps {
  loading?: boolean;
  visitData2?: DataItem[];
  searchData?: SearchDataItem[];
}

const defaultVisitData: DataItem[] = Array.from({ length: 12 }, (_, i) => ({
  x: `${i}:00`,
  y: Math.floor(Math.random() * 150) + 20,
}));

const defaultSearchData: SearchDataItem[] = [
  { index: 1, keyword: "Борлуулалтын тайлан", count: 986, range: 12.4, status: 0 },
  { index: 2, keyword: "Dashboard заавар", count: 745, range: 8.2, status: 0 },
  { index: 3, keyword: "KPI тооцоо", count: 534, range: -3.1, status: 1 },
  { index: 4, keyword: "Chart тохиргоо", count: 412, range: 5.8, status: 0 },
  { index: 5, keyword: "Excel экспорт", count: 298, range: -1.5, status: 1 },
  { index: 6, keyword: "Өгөгдлийн эх үүсвэр", count: 187, range: 15.2, status: 0 },
  { index: 7, keyword: "API холболт", count: 156, range: 22.7, status: 0 },
];

export const TopSearch: React.FC<TopSearchProps> = ({
  loading = false,
  visitData2 = defaultVisitData,
  searchData = defaultSearchData,
}) => {
  if (loading) {
    return (
      <div className="rounded-xl border border-border/80 bg-card p-5 animate-pulse">
        <div className="h-5 w-32 bg-foreground/10 rounded mb-4" />
        <div className="h-24 bg-foreground/5 rounded mb-4" />
        <div className="h-32 bg-foreground/5 rounded" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/80 bg-card p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider">
          Онлайн хайлтууд
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div>
          <NumberInfo
            title={
              <span className="inline-flex items-center gap-1.5">
                Хайлтын тоо
                <span className="inline-flex text-foreground/30 cursor-help" title="Хайлт хийсэн хэрэглэгчдийн тоо">
                  <Info className="w-3 h-3" />
                </span>
              </span>
            }
            total="12,321"
            status="up"
            subTotal={17.1}
            gap={8}
          />
          <div className="mt-2 h-[45px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={visitData2}>
                <defs>
                  <linearGradient id="searchGrad1" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="white" stopOpacity={0.01} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="y"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  fill="url(#searchGrad1)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <NumberInfo
            title={
              <span className="inline-flex items-center gap-1.5">
                Дундаж хайлт
                <span className="inline-flex text-foreground/30 cursor-help" title="Нэг хэрэглэгчийн дундаж хайлтын тоо">
                  <Info className="w-3 h-3" />
                </span>
              </span>
            }
            total="2.7"
            status="down"
            subTotal={26.2}
            gap={8}
          />
          <div className="mt-2 h-[45px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={visitData2}>
                <defs>
                  <linearGradient id="searchGrad2" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="white" stopOpacity={0.01} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="y"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  fill="url(#searchGrad2)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border/40 text-[10px] text-foreground/50 uppercase tracking-wider">
              <th className="text-left pb-2 pr-2 font-semibold">#</th>
              <th className="text-left pb-2 pr-2 font-semibold">Түлхүүр үг</th>
              <th className="text-right pb-2 pr-2 font-semibold">Хэрэглэгч</th>
              <th className="text-right pb-2 font-semibold">7 хоногийн өөрчлөлт</th>
            </tr>
          </thead>
          <tbody>
            {searchData.map((row) => (
              <tr
                key={row.index}
                className="border-b border-border/20 hover:bg-foreground/5 transition-colors"
              >
                <td className="py-2 pr-2 text-foreground/40 font-mono text-[10px]">
                  {row.index}
                </td>
                <td className="py-2 pr-2">
                  <a
                    href="#"
                    className="text-foreground/80 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    {row.keyword}
                  </a>
                </td>
                <td className="py-2 pr-2 text-right font-mono font-semibold text-foreground/70">
                  {row.count.toLocaleString()}
                </td>
                <td className="py-2 text-right">
                  <Trend flag={row.status === 1 ? "down" : "up"}>
                    {row.range}%
                  </Trend>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
