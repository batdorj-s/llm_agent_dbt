export type ChartType =
  | "line" | "area" | "bar" | "horizontal_bar" | "pie"
  | "combo" | "stacked_bar" | "heatmap" | "donut";

export const CHART_TYPES: ChartType[] = [
  "line", "area", "bar", "horizontal_bar", "pie",
  "combo", "stacked_bar", "heatmap", "donut",
];

export const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6"];

export const chartTheme = {
  colors: {
    primary: CHART_COLORS,
    categorical: CHART_COLORS,
    semantic: {
      bar: "#3b82f6",
      line: "#8b5cf6",
      area: "#06b6d4",
      pie: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"],
    },
  },
  font: {
    family: "inherit",
    sizes: {
      axis: 9,
      tick: 9,
      legend: 9,
      tooltip: 10,
      title: 10,
    },
  },
  animation: {
    isAnimationActive: true,
    duration: 400,
  },
  format: {
    mnt: (value: number): string => `₮${value.toLocaleString("mn-MN")}`,
    percent: (value: number): string => `${value.toLocaleString("mn-MN")}%`,
    number: (value: number): string => value.toLocaleString("mn-MN"),
    date: (date: Date): string =>
      date.toLocaleDateString("mn-MN", { year: "numeric", month: "numeric", day: "numeric" }),
    dateShort: (date: Date): string =>
      date.toLocaleDateString("mn-MN", { year: "numeric", month: "short" }),
  },
  tooltip: {
    contentStyle: {
      backgroundColor: "var(--background)",
      border: "1px solid var(--card-border)",
      fontSize: "10px",
      color: "var(--foreground)",
    },
  },
} as const;
