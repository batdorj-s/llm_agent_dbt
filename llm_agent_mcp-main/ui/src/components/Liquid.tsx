import React from "react";

interface LiquidProps {
  percent?: number;
  height?: number;
  className?: string;
}

const Liquid: React.FC<LiquidProps> = ({ percent = 0, height = 160, className = "" }) => {
  const pct = Math.max(0, Math.min(1, percent));
  const cx = 80;
  const cy = 80;
  const r = 70;
  const fillY = cy + r - pct * (r * 2);

  return (
    <div className={`flex items-center justify-center ${className}`} style={{ height }}>
      <svg width={160} height={160} viewBox="0 0 160 160">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth={2} className="text-foreground/10" />
        <clipPath id="liquid-clip">
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
        <g clipPath="url(#liquid-clip)">
          <rect x={0} y={fillY} width={160} height={160 - fillY} fill="var(--color-primary, #1677ff)" fillOpacity={0.6} />
        </g>
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="text-2xl font-bold" fill="currentColor">
          {Math.round(pct * 100)}%
        </text>
      </svg>
    </div>
  );
};

export default Liquid;
