"use client";

/**
 * Admin Analytics — platform usage analytics with charts.
 * Uses GET /api/admin/analytics (admin:system).
 */

import React from "react";
import { useCustom } from "@refinedev/core";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp, Table2, Users, Star } from "lucide-react";

interface TimePoint {
  day: string;
  total: string;
  success: string;
  failed: string;
}

interface NamedCount {
  table_name?: string;
  user_id?: string;
  queries: string;
}

interface RatingBucket {
  rating: number;
  count: number;
}

interface AnalyticsData {
  timeSeries: TimePoint[];
  topTables: NamedCount[];
  topUsers: NamedCount[];
  outcome: {
    total: number;
    success: number;
    failed: number;
    avgDurationMs: number;
    p95DurationMs: number;
    avgAttempts: number;
  };
  feedbackRatings: RatingBucket[];
}

const tooltipStyle = {
  backgroundColor: "var(--background)",
  border: "1px solid var(--card-border, #e2e8f0)",
  fontSize: "10px",
  color: "var(--foreground)",
  borderRadius: "6px",
} as const;

const axisTick = { fontSize: 9, fill: "currentColor", fillOpacity: 0.5 } as const;

function fmtNumber(v: number): string {
  return v.toLocaleString();
}

export default function AdminAnalyticsPage() {
  const { query, result } = useCustom<AnalyticsData>({
    url: "/api/admin/analytics",
    method: "get",
  });

  const data = result.data;
  const isLoading = query.isLoading;
  const isError = query.isError;

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-pulse text-foreground/60 text-sm">Ачааллаж байна...</div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-foreground/50 text-sm">
        Analytics ачаалахад алдаа гарлаа
      </div>
    );
  }

  const series = data.timeSeries.map((t) => ({
    day: t.day.slice(5),
    total: Number(t.total),
    success: Number(t.success),
    failed: Number(t.failed),
  }));
  const successRate = data.outcome.total > 0
    ? Math.round((data.outcome.success / data.outcome.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Аналитик</h1>
        <p className="text-xs text-foreground/50 mt-1">Платформын хэрэглээний үзүүлэлтүүд</p>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Нийт асуулга" value={fmtNumber(data.outcome.total)} />
        <StatCard label="Амжилттай" value={fmtNumber(data.outcome.success)} accent="text-emerald-600" />
        <StatCard label="Амжилтын хувь" value={`${successRate}%`} />
        <StatCard label="Дундаж хугацаа" value={`${data.outcome.avgDurationMs}ms`} />
        <StatCard label="p95 хугацаа" value={`${data.outcome.p95DurationMs}ms`} />
        <StatCard label="Дундаж оролдлого" value={String(data.outcome.avgAttempts)} />
      </div>

      {/* 14-day time series */}
      <ChartCard
        title="Сүүлийн 14 хоногийн асуулга"
        icon={<TrendingUp className="w-4 h-4" />}
      >
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border, #e2e8f0)" strokeOpacity={0.3} strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} width={40} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area
              type="monotone"
              dataKey="total"
              name="Нийт"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#totalGradient)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="failed"
              name="Алдаа"
              stroke="#ef4444"
              strokeWidth={1.5}
              fill="url(#failedGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Outcome pie */}
        <ChartCard title="Амжилт / Алдаа" icon={<TrendingUp className="w-4 h-4" />}>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={[
                  { name: "Амжилттай", value: data.outcome.success, color: "#10b981" },
                  { name: "Алдаатай", value: data.outcome.failed, color: "#ef4444" },
                ]}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={75}
                paddingAngle={2}
                isAnimationActive={false}
              >
                {(data.outcome.success + data.outcome.failed > 0) &&
                  [
                    { name: "Амжилттай", value: data.outcome.success, color: "#10b981" },
                    { name: "Алдаатай", value: data.outcome.failed, color: "#ef4444" },
                  ].map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 text-[10px] text-foreground/60">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Амжилттай {fmtNumber(data.outcome.success)}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Алдаатай {fmtNumber(data.outcome.failed)}
            </span>
          </div>
        </ChartCard>

        {/* Top tables */}
        <ChartCard title="Топ хүснэгтүүд" icon={<Table2 className="w-4 h-4" />}>
          {data.topTables.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.topTables} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--border, #e2e8f0)" strokeOpacity={0.3} strokeDasharray="3 3" />
                <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="table_name"
                  width={90}
                  tick={{ fontSize: 8, fill: "currentColor", fillOpacity: 0.5 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="queries" name="Асуулга" fill="#3b82f6" isAnimationActive={false} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Top users */}
        <ChartCard title="Топ хэрэглэгчид" icon={<Users className="w-4 h-4" />}>
          {data.topUsers.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.topUsers} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--border, #e2e8f0)" strokeOpacity={0.3} strokeDasharray="3 3" />
                <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="user_id"
                  width={90}
                  tick={{ fontSize: 8, fill: "currentColor", fillOpacity: 0.5 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="queries" name="Асуулга" fill="#8b5cf6" isAnimationActive={false} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Feedback ratings */}
      <ChartCard title="Feedback үнэлгээний хуваарилалт" icon={<Star className="w-4 h-4" />}>
        {data.feedbackRatings.every((b) => b.count === 0) ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.feedbackRatings} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border, #e2e8f0)" strokeOpacity={0.3} strokeDasharray="3 3" />
              <XAxis dataKey="rating" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} width={36} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" name="Тоо" fill="#f59e0b" isAnimationActive={false} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent = "",
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-2">
        {label}
      </div>
      <div className={`text-2xl font-bold text-foreground tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function ChartCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-foreground/40">{icon}</span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-[180px] text-[11px] text-foreground/40">
      Өгөгдөл байхгүй
    </div>
  );
}
