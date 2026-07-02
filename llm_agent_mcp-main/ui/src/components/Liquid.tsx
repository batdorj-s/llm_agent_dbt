import React, { useId } from "react";

interface LiquidProps {
  percent?: number;
  height?: number;
  className?: string;
}

const Liquid: React.FC<LiquidProps> = ({ percent = 0, height = 160, className = "" }) => {
  const uid = useId().replace(/:/g, "");
  const pct = Math.max(0, Math.min(1, percent));
  const cx = 80;
  const cy = 80;
  const r = 70;
  const fillY = cy + r - pct * (r * 2);
  const clipId = `liquid-clip-${uid}`;
  const gradId = `liquid-grad-${uid}`;

  return (
    <div className={`flex items-center justify-center ${className}`} style={{ height }}>
      <svg width={160} height={160} viewBox="0 0 160 160">
        <defs>
          <clipPath id={clipId}>
            <circle cx={cx} cy={cy} r={r} />
          </clipPath>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.85} />
            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.95} />
          </linearGradient>
        </defs>
        {/* Outer ring */}
        <circle
          cx={cx} cy={cy} r={r + 3}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          className="text-foreground/10"
        />
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          className="text-foreground/10"
        />
        {/* Fill */}
        <g clipPath={`url(#${clipId})`}>
          <rect
            x={0}
            y={fillY}
            width={160}
            height={160 - fillY}
            fill={`url(#${gradId})`}
          />
          {/* Wave effect */}
          <path
            d={`M0,${fillY} Q20,${fillY - 6} 40,${fillY} Q60,${fillY + 6} 80,${fillY} Q100,${fillY - 6} 120,${fillY} Q140,${fillY + 6} 160,${fillY} L160,160 L0,160 Z`}
            fill={`url(#${gradId})`}
            opacity={0.5}
          />
        </g>
        {/* Text */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={24}
          fontWeight={800}
          fill="white"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
        >
          {Math.round(pct * 100)}%
        </text>
        <text
          x={cx}
          y={cy + 18}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={9}
          fill="white"
          opacity={0.7}
        >
          хэрэглэлт
        </text>
      </svg>
    </div>
  );
};

export default Liquid;
