"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AreaChart, Area, ResponsiveContainer, ReferenceLine, YAxis } from "recharts";

function fixedZero(val: number) {
  return val < 10 ? `0${val}` : `${val}`;
}

function getActiveData() {
  const data: { x: string; y: number }[] = [];
  for (let i = 0; i < 24; i += 1) {
    data.push({
      x: `${fixedZero(i)}:00`,
      y: Math.floor(Math.random() * 200) + i * 50,
    });
  }
  return data;
}

export const ActiveChart = () => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeData, setActiveData] = useState<{ x: string; y: number }[]>(
    getActiveData,
  );

  useEffect(() => {
    const loopData = () => {
      setActiveData(getActiveData());
      timerRef.current = setTimeout(loopData, 2000);
    };
    timerRef.current = setTimeout(loopData, 2000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const { maxValue, medianValue } = useMemo(() => {
    if (!activeData.length) return { maxValue: 0, medianValue: 0 };
    const sorted = [...activeData].sort((a, b) => a.y - b.y);
    return {
      maxValue: sorted[sorted.length - 1]?.y ?? 0,
      medianValue: sorted[Math.floor(sorted.length / 2)]?.y ?? 0,
    };
  }, [activeData]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] text-foreground/60">
          <span className="text-foreground/40">Үнэлгээ: </span>
          Хүлээгдэж буй үзүүлэлтэд хүрэх боломжтой
        </span>
        <div className="flex gap-4 text-[10px] font-mono text-foreground/40">
          <span>↑ {maxValue + 200}</span>
          <span>≈ {medianValue}</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={130}>
        <AreaChart data={activeData} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <YAxis hide domain={[0, "auto"]} />
          <ReferenceLine
            y={maxValue}
            stroke="var(--color-border, #e2e8f0)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
          <ReferenceLine
            y={medianValue}
            stroke="var(--color-border, #e2e8f0)"
            strokeDasharray="4 4"
            strokeWidth={1}
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
        <span className="flex-1 text-left">00:00</span>
        <span className="flex-1 text-center">
          {activeData[Math.floor(activeData.length / 2)]?.x}
        </span>
        <span className="flex-1 text-right">
          {activeData[activeData.length - 1]?.x}
        </span>
      </div>
    </div>
  );
};
