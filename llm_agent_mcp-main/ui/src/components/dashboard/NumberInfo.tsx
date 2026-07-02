import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

interface NumberInfoProps {
  title?: React.ReactNode;
  subTitle?: React.ReactNode;
  total?: React.ReactNode;
  status?: "up" | "down";
  subTotal?: number;
  gap?: number;
}

export const NumberInfo: React.FC<NumberInfoProps> = ({
  title,
  subTitle,
  total,
  status,
  subTotal,
  gap = 8,
}) => {
  return (
    <div className="flex flex-col" style={{ gap }}>
      {title && (
        <div className="text-[11px] text-foreground/60 transition-colors">
          {title}
        </div>
      )}
      {subTitle && (
        <div className="text-[10px] text-foreground/40">{subTitle}</div>
      )}
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-extrabold text-foreground">{total}</span>
        {status && subTotal !== undefined && (
          <span
            className={`text-xs font-semibold inline-flex items-center gap-0.5 ${
              status === "up"
                ? "text-emerald-500"
                : "text-red-500"
            }`}
          >
            {status === "up" ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            {status === "up" ? "+" : ""}
            {subTotal}%
          </span>
        )}
      </div>
    </div>
  );
};
