"use client";

import { AreaChart, Area, ResponsiveContainer, ReferenceLine, YAxis, Tooltip } from "recharts";

interface CashDataPoint {
  x: string;
  label?: string;
  y: number;
}

const defaultCashData: CashDataPoint[] = [
  { x: "1/1", label: "1-р сарын эхлэл", y: 2118200 },
  { x: "2/1", label: "2-р сарын эхлэл", y: 1197539 },
  { x: "3/1", label: "3-р сарын эхлэл", y: 6582195 },
  { x: "4/1", label: "Q1 дуусгавар", y: 1049423 },
];

interface ActiveChartProps {
  cashData?: CashDataPoint[];
}

const formatM = (v: number) => `₮${(v / 1_000_000).toFixed(2)}M`;

export const ActiveChart: React.FC<ActiveChartProps> = ({ cashData = defaultCashData }) => {
  const peak = Math.max(...cashData.map((d) => d.y));
  const opening = cashData[0].y;
  const closing = cashData[cashData.length - 1].y;
  const netChange = closing - opening;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] text-foreground/60">
          <span className="text-foreground/40">Мөнгөний үлдэгдэл: </span>
          Эхлэл {formatM(opening)} → Хаалт {formatM(closing)}
        </span>
        <div className="flex gap-4 text-[10px] font-mono">
          <span className="text-foreground/40">↑ {formatM(peak)}</span>
          <span className={netChange >= 0 ? "text-emerald-500" : "text-red-400"}>
            {netChange >= 0 ? "▲" : "▼"} {formatM(Math.abs(netChange))}
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={130}>
        <AreaChart data={cashData} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <YAxis hide domain={[0, "auto"]} />
          <ReferenceLine
            y={peak}
            stroke="var(--color-border, #e2e8f0)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
          <Tooltip
            formatter={(value) => [formatM(Number(value)), "Үлдэгдэл"]}
            labelFormatter={(label) => {
              const item = cashData.find((d) => d.x === label);
              return item?.label ?? label;
            }}
            contentStyle={{
              fontSize: 11,
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              backgroundColor: "var(--color-card)",
            }}
          />
          <Area
            type="monotone"
            dataKey="y"
            stroke="#3b82f6"
            strokeWidth={1.5}
            fill="#3b82f6"
            fillOpacity={0.15}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex text-[10px] text-foreground/40 mt-1.5 font-mono">
        <span className="flex-1 text-left">1/1 эхлэл</span>
        <span className="flex-1 text-center">3/1 оргил</span>
        <span className="flex-1 text-right">4/1 хаалт</span>
      </div>
    </div>
  );
};
