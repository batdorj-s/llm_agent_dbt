"use client";

import React, { useMemo } from "react";
import { KpiData, SalesHistory } from "./types";
import { ChartCard, NumberInfo, Trend, Field } from "./dashboard";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface DashboardPanelProps {
  salesKpi: KpiData | null;
  usersKpi: KpiData | null;
  churnKpi: KpiData | null;
  salesHistory?: SalesHistory[];
  growthRate?: number | null;
  growthDirection?: "up" | "down";
  topCategory?: string | null;
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export const DashboardPanel = React.memo(({
  salesKpi,
  usersKpi,
  churnKpi,
  salesHistory = [],
  growthRate,
  growthDirection,
  topCategory,
}: DashboardPanelProps) => {
  const formatCurrency = (value: number) =>
    `$${value.toLocaleString(undefined, { minimumFractionDigits: 0 })}`;

  const salesReach = useMemo(
    () => salesKpi && salesKpi.target > 0
      ? Math.min(Math.round((salesKpi.current / salesKpi.target) * 100), 100)
      : 0,
    [salesKpi?.current, salesKpi?.target]
  );

  const pieData = useMemo(() => [
    { name: "Reached", value: salesReach },
    { name: "Remaining", value: 100 - salesReach },
  ], [salesReach]);

  return (
    <div className="space-y-4">
      <div className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2">
        Үндсэн үзүүлэлтүүд
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ChartCard
          title="Борлуулалт"
          total={`${formatCurrency(salesKpi?.current || 0)}`}
          subTotal={growthRate ?? undefined}
          status={growthDirection}
          footer={<Field label="Зорилтот" value={formatCurrency(salesKpi?.target || 0)} />}
          contentHeight={80}
        >
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={salesHistory.slice(-6)}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e2e8f0)" />
              <XAxis dataKey="month" hide />
              <YAxis hide />
              <Tooltip
                formatter={(value: any) => formatCurrency(Number(value) || 0)}
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                }}
              />
              <Bar dataKey="revenue" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Идэвхтэй хэрэглэгчид"
          total={usersKpi?.current.toLocaleString() || "—"}
          footer={<Field label="Зорилго" value={usersKpi?.target.toLocaleString() || "—"} />}
          contentHeight={80}
        >
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={salesHistory.slice(-6)}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e2e8f0)" />
              <XAxis dataKey="month" hide />
              <YAxis hide />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.15}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Churn Rate"
          total={churnKpi ? `${churnKpi.current}%` : "—"}
          subTotal={
            churnKpi
              ? Math.round(((churnKpi.current - churnKpi.target) / churnKpi.target) * 100)
              : undefined
          }
          status={
            churnKpi && churnKpi.current > churnKpi.target ? "down" : "up"
          }
          footer={
            <Field
              label="Хязгаар"
              value={churnKpi ? `${churnKpi.target}%` : "—"}
            />
          }
          contentHeight={80}
        >
          <ResponsiveContainer width="100%" height={80}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={14}
                outerRadius={22}
                dataKey="value"
                startAngle={90}
                endAngle={-270}
              >
                {pieData.map((_, i) => (
                  <Cell
                    key={i}
                    fill={
                      i === 0
                        ? churnKpi && churnKpi.current > churnKpi.target
                          ? "#ef4444"
                          : "#10b981"
                        : "var(--color-border, #e2e8f0)"
                    }
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Шилдэг категори"
          total={topCategory || "—"}
          footer={
            <Field
              label="Бүтээгдэхүүн"
              value={topCategory ? `${topCategory} +1` : "—"}
            />
          }
          contentHeight={80}
        >
          <div className="flex items-center justify-center h-full text-3xl font-bold text-foreground/20">
            {topCategory ? topCategory[0] : "?"}
          </div>
        </ChartCard>
      </div>

      {salesHistory.length > 0 && (
        <div className="rounded-xl border border-border/80 bg-card p-5">
          <div className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-4">
            Борлуулалтын чиг хандлага
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={salesHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e2e8f0)" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: "var(--color-foreground)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--color-foreground)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(value: any) => formatCurrency(Number(value) || 0)}
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="#3b82f6"
                fillOpacity={0.1}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider mb-2 mt-2">
        Дэлгэрэнгүй үзүүлэлтүүд
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <NumberInfo
            title="Борлуулалтын гүйцэтгэл"
            total={salesKpi ? `${Math.round((salesKpi.current / salesKpi.target) * 100)}%` : "—"}
            subTitle="Зорилтоттой харьцуулалт"
            status={salesKpi && salesKpi.current >= salesKpi.target ? "up" : "down"}
            subTotal={salesKpi ? Math.abs(Math.round(((salesKpi.current - salesKpi.target) / salesKpi.target) * 100)) : undefined}
          />
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <NumberInfo
            title="Өсөлтийн хурд"
            total={growthRate !== null ? `${growthRate?.toFixed(1)}%` : "—"}
            subTitle="Сүүлийн 30 хоног"
            status={growthDirection}
            subTotal={growthRate !== null ? Math.abs(Math.round(growthRate!)) : undefined}
          />
        </div>
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <NumberInfo
            title="Churn харьцуулалт"
            total={churnKpi ? `${churnKpi.current}%` : "—"}
            subTitle={churnKpi ? `Хязгаар: ${churnKpi.target}%` : ""}
            status={churnKpi && churnKpi.current > churnKpi.target ? "down" : "up"}
            subTotal={churnKpi ? Math.abs(Math.round(((churnKpi.current - churnKpi.target) / churnKpi.target) * 100)) : undefined}
          />
        </div>
      </div>
    </div>
  );
});
