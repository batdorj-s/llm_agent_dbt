import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

interface TrendProps {
  flag: "up" | "down";
  colorful?: boolean;
  reverseColor?: boolean;
  children?: React.ReactNode;
}

export const Trend: React.FC<TrendProps> = ({
  flag,
  colorful = true,
  reverseColor = false,
  children,
}) => {
  const isUp =
    reverseColor ? flag === "down" : flag === "up";

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        colorful
          ? isUp
            ? "text-emerald-500"
            : "text-red-500"
          : "text-foreground/60"
      }`}
    >
      <span>{children}</span>
      {flag === "up" ? (
        <TrendingUp className="w-3 h-3" />
      ) : (
        <TrendingDown className="w-3 h-3" />
      )}
    </span>
  );
};
