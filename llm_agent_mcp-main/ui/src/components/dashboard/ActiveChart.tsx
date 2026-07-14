"use client";

import { AreaChart, Area, ResponsiveContainer, ReferenceLine, YAxis, XAxis, Tooltip, CartesianGrid } from "recharts";

interface CashDataPoint {
  x: string;
  label?: string;
  y: number;
}

interface ActiveChartProps {
  cashData?: CashDataPoint[];
}

const fmtM = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `₮${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `₮${(v / 1_000).toFixed(0)}К`;
  return `₮${v.toLocaleString()}`;
};

const tooltipStyle = {
  backgroundColor: "var(--background)",
  border: "1px solid var(--card-border, #e2e8f0)",
  fontSize: "10px",
  color: "var(--foreground)",
  borderRadius: "6px",
};

export const ActiveChart: React.FC<ActiveChartProps> = ({ cashData }) => {
  if (!cashData || cashData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-[11px] text-foreground/40">
        Өгөгдөл байхгүй
      </div>
    );
  }

  const peak = Math.max(...cashData.map((d) => d.y));
  const opening = cashData[0].y;
  const closing = cashData[cashData.length - 1].y;
  const netChange = closing - opening;
  const isPositive = netChange >= 0;

  return (
    <div>
      {/* Stats row — wraps on small screens */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2 mb-4">
        <div>
          <div className="text-[9px] text-foreground/40 uppercase tracking-wider mb-0.5">Эхлэлийн үлдэгдэл</div>
          <div className="text-base font-bold text-foreground">{fmtM(opening)}</div>
        </div>
        <div>
          <div className="text-[9px] text-foreground/40 uppercase tracking-wider mb-0.5">Хаалтын үлдэгдэл</div>
          <div className="text-base font-bold text-foreground">{fmtM(closing)}</div>
        </div>
        <div>
          <div className="text-[9px] text-foreground/40 uppercase tracking-wider mb-0.5">Хамгийн өндөр</div>
          <div className="text-base font-bold text-blue-500">{fmtM(peak)}</div>
        </div>
        <div>
          <div className="text-[9px] text-foreground/40 uppercase tracking-wider mb-0.5">Цэвэр өөрчлөлт</div>
          <div className={`text-base font-bold ${isPositive ? "text-emerald-500" : "text-red-400"}`}>
            {isPositive ? "▲" : "▼"} {fmtM(Math.abs(netChange))}
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={cashData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="cashGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border, #e2e8f0)" strokeOpacity={0.3} strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            tick={{ fontSize: 9, fill: "currentColor", fillOpacity: 0.5 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: "currentColor", fillOpacity: 0.5 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={fmtM}
            width={56}
          />
          <ReferenceLine
            y={peak}
            stroke="#3b82f6"
            strokeDasharray="4 4"
            strokeWidth={1}
            strokeOpacity={0.4}
          />
          <Tooltip
            formatter={(value) => [fmtM(Number(value)), "Үлдэгдэл"]}
            labelFormatter={(label) => {
              const item = cashData.find((d) => d.x === label);
              return item?.label ?? label;
            }}
            contentStyle={tooltipStyle}
          />
          <Area
            type="monotone"
            dataKey="y"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#cashGradient)"
            isAnimationActive={false}
            dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
