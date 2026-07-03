"use client";

import React, { useEffect, useState } from "react";
import { VisualMessage } from "./VisualMessage";

interface FinanceChart {
  id: string;
  title: string;
  type: string;
  data: { label: string; value: number; value2?: number }[];
  config: Record<string, unknown>;
}

interface FinanceChartsResponse {
  isFinance: boolean;
  tableName?: string;
  charts?: FinanceChart[];
  summary?: {
    totalIncome: number;
    totalExpense: number;
    operatingProfit: number;
    totalTransactions: number;
  };
}

interface Props {
  token: string;
}

const fmtMnt = (v: number) => `₮${Math.round(v).toLocaleString()}`;

const CHART_DESCRIPTIONS: Record<string, string> = {
  category_breakdown: "Нийт зарлагыг ангилал тус бүрээр задлан харуулна. Аль ангилал хамгийн их зардал гаргаж байгааг харьцуулахад тохиромжтой.",
  monthly_cashflow: "Сар бүрийн нийт орлого болон зарлагыг хамт харуулна. Мөнгөн урсгалын чиг хандлага болон орлого-зарлагын тэнцвэрийг тодорхойлоход туслана.",
  top_parties: "Орлогоор хамгийн өндөр харилцагчдыг жагсааж харуулна. Гол хувь нэмэр оруулагч талуудыг тодорхойлоход ашиглана.",
  daily_trend: "Өдөр бүрийн цэвэр орлогын хэлбэлзлийг харуулна. Богино хугацааны ерөнхий чиг хандлагыг шинжлэхэд тохиромжтой.",
  monthly_profit: "Сар бүрийн үйл ажиллагааны ашиг эсвэл алдагдлыг харуулна. Ашигт ажиллагааны цаг хугацааны динамикийг тодорхойлоход ашиглана.",
  expense_breakdown_monthly: "Зарлагын дэд ангилал бүрийг сараар задлан харуулна. Зарлагын бүтэц хэрхэн өөрчлөгдөж байгааг сараар харьцуулан шинжлэхэд туслана.",
};

const ChartSkeleton = () => (
  <div className="rounded-xl border border-border/60 bg-card p-5 animate-pulse shadow-sm">
    <div className="h-3 w-1/3 bg-foreground/10 rounded mb-4" />
    <div className="h-52 bg-foreground/5 rounded" />
  </div>
);

const KpiSkeleton = () => (
  <div className="rounded-xl border border-border/60 bg-card p-4 animate-pulse shadow-sm flex items-start gap-3">
    <div className="w-10 h-10 rounded-lg bg-foreground/10 flex-shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-2.5 w-2/3 bg-foreground/10 rounded" />
      <div className="h-5 w-1/2 bg-foreground/10 rounded" />
    </div>
  </div>
);

const IconIncome = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
  </svg>
);

const IconExpense = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m0 0l7-7m-7 7l-7-7" />
  </svg>
);

const IconProfit = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

export function FinanceDashboard({ token }: Props) {
  const [data, setData] = useState<FinanceChartsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch("/api/finance-charts", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : Promise.resolve({ isFinance: false }))
      .then((json) => { if (!cancelled) { setData(json); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData({ isFinance: false }); setLoading(false); } });

    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="text-[10px] font-bold text-foreground/40 uppercase tracking-widest">
          Санхүүгийн хяналтын самбар
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => <ChartSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  if (!data?.isFinance || !data.charts || data.charts.length === 0) {
    return null;
  }

  const kpis = data.summary ? [
    {
      label: "Нийт орлого",
      value: data.summary.totalIncome,
      color: "#3b82f6",
      bg: "#3b82f615",
      icon: <IconIncome />,
    },
    {
      label: "Нийт зарлага",
      value: data.summary.totalExpense,
      color: "#ef4444",
      bg: "#ef444415",
      icon: <IconExpense />,
    },
    {
      label: "ҮА ашиг / алдагдал",
      value: data.summary.operatingProfit,
      color: data.summary.operatingProfit >= 0 ? "#10b981" : "#ef4444",
      bg: data.summary.operatingProfit >= 0 ? "#10b98115" : "#ef444415",
      icon: <IconProfit />,
    },
  ] : [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 rounded-full bg-blue-500" />
        <span className="text-[11px] font-bold text-foreground/60 uppercase tracking-widest">
          Санхүүгийн хяналтын самбар
        </span>
        {data.tableName && (
          <span className="text-[10px] text-foreground/30 font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
            {data.tableName}
          </span>
        )}
      </div>

      {/* KPI cards — ant-design-pro ChartCard avatar style */}
      {kpis.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {kpis.map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-border/60 bg-card p-4 flex items-start gap-3 shadow-sm hover:shadow-md transition-shadow duration-150"
            >
              {/* Avatar circle with icon */}
              <div
                className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: item.bg, color: item.color }}
              >
                {item.icon}
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-foreground/50 font-semibold uppercase tracking-wider mb-1 truncate">
                  {item.label}
                </div>
                <div
                  className="text-lg font-extrabold tracking-tight leading-none"
                  style={{ color: item.color }}
                >
                  {fmtMnt(item.value)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.charts.map((chart) => {
          const visualJson = JSON.stringify({
            title: chart.title,
            type: chart.type,
            data: chart.data,
            config: {
              xAxis: "label",
              yAxis: "value",
              description: CHART_DESCRIPTIONS[chart.id],
              ...chart.config,
            },
          });

          return (
            <div
              key={chart.id}
              className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm"
            >
              <VisualMessage visualJson={visualJson} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
