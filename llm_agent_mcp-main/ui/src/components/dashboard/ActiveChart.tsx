"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";

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
    <div className="relative">
      <div className="text-xs text-foreground/70 font-medium mb-2">
        <span className="text-foreground/50">Үнэлгээ: </span>
        Хүлээгдэж буй үзүүлэлтэд хүрэх боломжтой
      </div>

      <div className="h-[84px]">
        <ResponsiveContainer width="100%" height={84}>
          <AreaChart data={activeData}>
            <Area
              type="monotone"
              dataKey="y"
              stroke="#3b82f6"
              strokeWidth={1.5}
              fill="#3b82f6"
              fillOpacity={0.15}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {activeData.length > 0 && (
        <>
          <div className="relative" style={{ marginTop: -60, marginLeft: -3 }}>
            <p className="absolute text-[10px] text-foreground/50 font-mono whitespace-nowrap" style={{ top: 0 }}>
              {maxValue + 200}
            </p>
            <p className="absolute text-[10px] text-foreground/50 font-mono whitespace-nowrap" style={{ top: 35 }}>
              {medianValue}
            </p>
            <div className="relative" style={{ top: -70, left: 0 }}>
              <div
                className="w-full h-px"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, transparent 50%, var(--color-border, #e2e8f0) 50%)",
                  backgroundSize: "6px 1px",
                }}
              />
            </div>
            <div className="relative" style={{ top: -36, left: 0 }}>
              <div
                className="w-full h-px"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, transparent 50%, var(--color-border, #e2e8f0) 50%)",
                  backgroundSize: "6px 1px",
                }}
              />
            </div>
          </div>

          <div className="flex text-[11px] text-foreground/40 mt-2">
            <span className="flex-1 text-left">00:00</span>
            <span className="flex-1 text-center">
              {activeData[Math.floor(activeData.length / 2)]?.x}
            </span>
            <span className="flex-1 text-right">
              {activeData[activeData.length - 1]?.x}
            </span>
          </div>
        </>
      )}
    </div>
  );
};
