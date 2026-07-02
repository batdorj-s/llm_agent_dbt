"use client";

import React from "react";

interface CounterpartyItem {
  index: number;
  name: string;
  amount: number;
  share: number;
}

interface TopSearchProps {
  loading?: boolean;
  counterparties?: CounterpartyItem[];
}

const defaultCounterparties: CounterpartyItem[] = [
  { index: 1, name: "ВАЙРАЛ ПИКСЕЛЬ ХХК", amount: 161220000, share: 84.6 },
  { index: 2, name: "БАТБИЛЭГ БИЛЭГСАЙХАН", amount: 26950000, share: 14.1 },
  { index: 3, name: "АНУДАРЬ ТҮВШИНБАЯР", amount: 1227000, share: 0.6 },
  { index: 4, name: "ДАЙСҮКИ ГЛОБАЛ КОО", amount: 1227000, share: 0.6 },
];

const RANK_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6"];

const formatCurrencyM = (v: number) => `₮${(v / 1_000_000).toFixed(1)}M`;

export const TopSearch: React.FC<TopSearchProps> = ({
  loading = false,
  counterparties = defaultCounterparties,
}) => {
  const totalIncome = counterparties.reduce((sum, c) => sum + c.amount, 0);

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
          Орлогын эх үүсвэр
        </h3>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-foreground/[0.03] border border-border/40 rounded-lg p-3">
          <div className="text-[10px] text-foreground/40 mb-1 uppercase font-semibold tracking-wider">
            Q1 нийт орлого
          </div>
          <div className="text-base font-extrabold text-emerald-500">
            {formatCurrencyM(totalIncome)}
          </div>
          <div className="text-[10px] text-foreground/40 mt-0.5">2026 оны I улирал</div>
        </div>
        <div className="bg-foreground/[0.03] border border-border/40 rounded-lg p-3">
          <div className="text-[10px] text-foreground/40 mb-1 uppercase font-semibold tracking-wider">
            Харилцагч
          </div>
          <div className="text-base font-extrabold text-blue-500">
            {counterparties.length}
          </div>
          <div className="text-[10px] text-foreground/40 mt-0.5">Орлогын эх үүсвэр</div>
        </div>
      </div>

      {/* Counterparty Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border/40 text-[10px] text-foreground/50 uppercase tracking-wider">
              <th className="text-left pb-2 pr-2 font-semibold w-8">#</th>
              <th className="text-left pb-2 pr-2 font-semibold">Харилцагч</th>
              <th className="text-right pb-2 pr-3 font-semibold">Орлого</th>
              <th className="text-right pb-2 font-semibold">Хувь</th>
            </tr>
          </thead>
          <tbody>
            {counterparties.map((row, i) => (
              <tr
                key={row.index}
                className="border-b border-border/20 hover:bg-foreground/5 transition-colors"
              >
                <td className="py-2.5 pr-2">
                  <span
                    className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                    style={{ background: RANK_COLORS[i % RANK_COLORS.length] }}
                  >
                    {row.index}
                  </span>
                </td>
                <td className="py-2.5 pr-2 max-w-[120px]">
                  <span
                    className="text-foreground/80 font-medium text-[10px] block truncate"
                    title={row.name}
                  >
                    {row.name}
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-right font-mono font-semibold text-foreground/70 whitespace-nowrap">
                  {formatCurrencyM(row.amount)}
                </td>
                <td className="py-2.5 text-right">
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-bold font-mono text-[10px] text-foreground/60">
                      {row.share}%
                    </span>
                    <div className="w-12 h-1 bg-foreground/10 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(row.share, 100)}%`,
                          background: RANK_COLORS[i % RANK_COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
