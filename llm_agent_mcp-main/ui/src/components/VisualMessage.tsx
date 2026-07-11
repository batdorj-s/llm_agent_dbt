"use client";

import React, { useState, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, Legend, ComposedChart, CartesianGrid, ScatterChart, Scatter, ZAxis } from "recharts";
import { chartTheme, type ChartType } from "./chartTheme";
import { DEFAULT_COLORS } from "./types";

const fmtCompact = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}М`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}К`;
  return v.toLocaleString();
};

const fmtFull = (v: number): string => `₮${Math.round(v).toLocaleString()}`;

const tooltipFormatter = (value: any) => [fmtFull(Number(value)), ""];

/* Ant-design-pro style ranking list — top 3 numbers highlighted */
const RankList = ({ items }: { items: { label: string; value: number }[] }) => (
  <ul className="space-y-1.5 mt-2">
    {items.map((item, i) => (
      <li key={i} className="flex items-center gap-2 text-[10px]">
        <span
          className={`flex-shrink-0 w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center ${
            i < 3
              ? "bg-foreground text-background"
              : "bg-foreground/10 text-foreground/50"
          }`}
        >
          {i + 1}
        </span>
        <span className="flex-1 truncate text-foreground/70">{item.label}</span>
        <span className="font-semibold text-foreground/80 tabular-nums">{fmtCompact(item.value)}</span>
      </li>
    ))}
  </ul>
);

const ChartSkeleton = () => (
  <div className="animate-pulse space-y-2 p-4">
    <div className="h-3 bg-foreground/10 rounded w-1/3" />
    <div className="h-40 bg-foreground/5 rounded" />
  </div>
);

const ChartEmptyState = ({ message }: { message?: string }) => (
  <div className="flex flex-col items-center justify-center h-40 text-foreground/40 gap-2">
    <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
    <span className="text-[10px]">{message || "Өгөгдөл олдсонгүй"}</span>
  </div>
);

const sanitizeVisualJson = (str: string): string => {
  let s = str.trim();
  if (!s) return s;
  try { JSON.parse(s); return s; } catch { /* try fixing common LLM issues */ }
  s = s.replace(/,\s*([\]}])/g, "$1");
  s = s.replace(/([{,]\s*)(\w[\w\d_]*)(\s*:)/g, "$1\"$2\"$3");
  s = s.replace(/'/g, '"');
  try { JSON.parse(s); return s; } catch {}
  return s;
};

const CHART_LABELS: Record<ChartType, string> = {
  bar: "Багана", horizontal_bar: "Хэвтээ", line: "Шугам", area: "Талбай",
  pie: "Бялуу", donut: "Donut", combo: "Хосолмол", stacked_bar: "Давхар", heatmap: "Дулааны",
  scatter: "Сарнилт", waterfall: "Усны хүрд",
};

export function getCompatibleTypes(series: string[] | undefined, hasMultiNumeric: boolean): ChartType[] {
  const base: ChartType[] = ["bar", "horizontal_bar", "line", "area", "pie", "donut", "heatmap", "scatter", "waterfall"];
  if (series && series.length > 1) {
    return [...base, "combo", "stacked_bar"];
  }
  if (hasMultiNumeric) {
    return [...base, "stacked_bar"];
  }
  return base;
}

export const VisualMessage = ({ visualJson }: { visualJson: string }) => {
  const sanitizedJson = sanitizeVisualJson(visualJson);
  const [heatmapTip, setHeatmapTip] = useState<{ label: string; value: number; x: number; y: number } | null>(null);
  const [userType, setUserType] = useState<ChartType | null>(null);
  const [drillDown, setDrillDown] = useState<{ label: string; value: number; x: number; y: number } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  let data: { title?: string; type?: string; data?: Record<string, unknown>[]; config?: Record<string, unknown> };
  try {
    data = JSON.parse(sanitizedJson);
  } catch (e) {
    console.error("Visual JSON Parse Error:", e);
    return <div className="text-[9px] text-red-500">Failed to render graphic: {String(e)}</div>;
  }

  if (!data.data || !Array.isArray(data.data)) {
    return (
      <div className="bg-sidebar border border-border rounded-lg p-4 mt-2 max-w-full sm:max-w-lg">
        <ChartEmptyState message="Буруу өгөгдлийн бүтэц" />
      </div>
    );
  }
  if (data.data.length === 0) {
    return (
      <div className="bg-sidebar border border-border rounded-lg p-4 mt-2 max-w-full sm:max-w-lg">
        <ChartEmptyState />
      </div>
    );
  }

  const config = data.config || {};
  const colors = (config.colors as string[]) || DEFAULT_COLORS;
  const series = config.series as string[] | undefined;
  const stacked = config.stacked === true;
  const description = config.description as string | undefined;
  const effectiveType: ChartType = userType || (data.type as ChartType) || "bar";
  const hasMultiNumeric = data.data.some((r: any) =>
    Object.keys(r).filter(k => k !== "label").length > 1
  );
  const compatible = getCompatibleTypes(series, hasMultiNumeric);

  const gridStyle = { stroke: "var(--border)", strokeOpacity: 0.4, strokeDasharray: "3 3" };

  const renderMultiSeries = (ChartComponent: any, DataComponent: any, extraProps?: Record<string, unknown>) => {
    const s = series || ["value"];
    return (
      <ChartComponent data={rows} layout={extraProps?.layout || undefined}>
        <CartesianGrid {...gridStyle} />
        {extraProps?.layout === "vertical" ? null : (
          <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} tick={{ fontSize: chartTheme.font.sizes.axis }} />
        )}
        {extraProps?.layout === "vertical" ? (
          <YAxis dataKey="label" type="category" stroke="#888888" fontSize={chartTheme.font.sizes.axis} width={90} />
        ) : (
          <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
        )}
        {extraProps?.layout === "vertical" ? (
          <XAxis type="number" stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} />
        ) : null}
        <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
        {s.length > 1 && <Legend wrapperStyle={{ fontSize: `${chartTheme.font.sizes.legend}px` }} />}
        {s.map((key, i) => (
          <DataComponent key={key} type="monotone" dataKey={key} fill={colors[i % colors.length]} stroke={colors[i % colors.length]} stackId={stacked ? "stack" : undefined} radius={DataComponent === Bar ? [3, 3, 0, 0] : undefined} />
        ))}
      </ChartComponent>
    );
  };

  const rows = data.data!;
  const renderChartContent = (chartType: ChartType) => {
    switch (chartType) {
      case "bar":
        return stacked ? renderMultiSeries(BarChart, Bar) : series && series.length > 1 ? renderMultiSeries(BarChart, Bar) : (
          <BarChart data={rows} onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Bar dataKey="value" fill={colors[0]} radius={[3, 3, 0, 0]} />
          </BarChart>
        );
      case "horizontal_bar":
        return series && series.length > 1 ? renderMultiSeries(BarChart, Bar, { layout: "vertical" }) : (
          <BarChart data={rows} layout="vertical" onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <CartesianGrid {...gridStyle} horizontal={false} />
            <XAxis type="number" stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} />
            <YAxis dataKey="label" type="category" stroke="#888888" fontSize={chartTheme.font.sizes.axis} width={90} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Bar dataKey="value" fill={colors[0]} radius={[0, 3, 3, 0]} />
          </BarChart>
        );
      case "line":
        return series && series.length > 1 ? renderMultiSeries(LineChart, Line) : (
          <LineChart data={rows} onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Line type="monotone" dataKey="value" stroke={colors[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        );
      case "area":
        return series && series.length > 1 ? renderMultiSeries(AreaChart, Area) : (
          <AreaChart data={rows} onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <defs>
              <linearGradient id="areaGradient0" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors[0]} stopOpacity={0.25} />
                <stop offset="95%" stopColor={colors[0]} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Area type="monotone" dataKey="value" fill="url(#areaGradient0)" stroke={colors[0]} strokeWidth={2} />
          </AreaChart>
        );
      case "donut":
      case "pie":
        return (
          <PieChart onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: 100, y: 60 }); }}>
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Pie
              data={rows}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={72}
              innerRadius={chartType === "donut" ? 32 : 0}
              label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""}: ${fmtCompact(Number(value ?? 0))}`}
              labelLine={false}
            >
              {rows.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Legend wrapperStyle={{ fontSize: `${chartTheme.font.sizes.legend}px` }} />
          </PieChart>
        );
      case "combo":
        return (
          <ComposedChart data={rows} onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Legend wrapperStyle={{ fontSize: `${chartTheme.font.sizes.legend}px` }} />
            <Bar dataKey="value" fill={colors[0]} radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey={series?.[1] || "lineValue"} stroke={colors[1]} strokeWidth={2} dot={false} />
          </ComposedChart>
        );
      case "stacked_bar":
        return series && series.length > 1 ? renderMultiSeries(BarChart, Bar) : (
          <BarChart data={rows} onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Bar dataKey="value" fill={colors[0]} stackId="auto" radius={[3, 3, 0, 0]} />
          </BarChart>
        );
      case "heatmap":
        return (
          <div className="relative w-full h-full">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-0.5 w-full h-full">
              {(rows as Record<string, unknown>[]).map((row: any, i: number) => {
                const val = parseFloat(row.value) || 0;
                const maxVal = Math.max(...(rows as Record<string, unknown>[]).map((r: any) => parseFloat(r.value) || 0), 1);
                const intensity = Math.min(val / maxVal, 1);
                const colorIndex = Math.floor((1 - intensity) * (colors.length - 1));
                return (
                  <div
                    key={i}
                    className="flex items-center justify-center text-[7px] text-white rounded cursor-pointer"
                    style={{ backgroundColor: colors[Math.min(colorIndex, colors.length - 1)], aspectRatio: "1" }}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const parent = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
                      setHeatmapTip({ label: row.label, value: val, x: rect.left - (parent?.left || 0), y: rect.top - (parent?.top || 0) - 28 });
                    }}
                    onMouseLeave={() => setHeatmapTip(null)}
                  >
                    {String(row.label).slice(0, 3)}
                  </div>
                );
              })}
            </div>
            {heatmapTip && (
              <div
                style={{
                  ...chartTheme.tooltip.contentStyle,
                  position: "absolute",
                  left: heatmapTip.x,
                  top: heatmapTip.y,
                  pointerEvents: "none",
                  whiteSpace: "nowrap",
                  zIndex: 50,
                }}
              >
                {heatmapTip.label}: {fmtFull(heatmapTip.value)}
              </div>
            )}
          </div>
        );
      case "scatter":
        return (
          <ScatterChart data={rows} onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" name="Label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis dataKey="value" name="Value" stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
            <ZAxis dataKey="value" range={[60, 60]} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Scatter data={rows} fill={colors[0]} />
          </ScatterChart>
        );
      case "waterfall":
        // Waterfall: cumulative bar chart showing positive/negative changes
        const waterfallData = rows.map((row: any, i: number) => {
          const val = parseFloat(row.value) || 0;
          const prevSum = rows.slice(0, i).reduce((sum: number, r: any) => sum + (parseFloat(r.value) || 0), 0);
          return {
            ...row,
            start: prevSum,
            end: prevSum + val,
            isPositive: val >= 0,
          };
        });
        return (
          <BarChart data={waterfallData} onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Bar dataKey="start" stackId="waterfall" fill="transparent" />
            <Bar dataKey="end" stackId="waterfall" radius={[3, 3, 0, 0]}>
              {waterfallData.map((entry: any, i: number) => (
                <Cell key={i} fill={entry.isPositive ? "#10b981" : "#ef4444"} />
              ))}
            </Bar>
          </BarChart>
        );
      default:
        return null;
    }
  };

  const chartRef = useRef<HTMLDivElement>(null);
  const handleDrillDown = (e: any, row: any) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return;
    const val = parseFloat(row.value) || parseFloat(row[Object.keys(row).find(k => k !== "label") || ""]) || 0;
    setDrillDown({ label: String(row.label ?? ""), value: val, x: e.clientX - rect.left, y: e.clientY - rect.top - 8 });
  };

  const maybeRow = (data: any) => {
    if (!data) return null;
    const label = data.label ?? data.activeLabel ?? data.name ?? "";
    const value = data.value ?? data[data.dataKey ?? "value"] ?? 0;
    return { label: String(label), value: parseFloat(value) || 0 };
  };

  const handleExport = async () => {
    const svg = chartRef.current?.querySelector("svg.recharts-surface") || chartRef.current?.querySelector("svg");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      ctx!.scale(2, 2);
      ctx!.fillStyle = "#fff";
      ctx!.fillRect(0, 0, canvas.width, canvas.height);
      ctx!.drawImage(img, 0, 0);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `chart-${effectiveType}-${Date.now()}.png`;
      a.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  };

  return (
    <div className="bg-card border border-border/60 rounded-xl p-4 mt-2 max-w-full sm:max-w-lg shadow-sm hover:shadow-md transition-all duration-200" ref={chartRef}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="block w-0.5 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: colors[0] }} />
          <h4 className="text-[11px] font-semibold text-foreground/80 truncate">{data.title || "Дүн шинжилгээ"}</h4>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Info / тайлбар button */}
          {description && (
            <button
              onClick={() => setInfoOpen(v => !v)}
              title="Тайлбар харах"
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold border transition-all duration-150 ${
                infoOpen
                  ? "bg-blue-500 border-blue-500 text-white"
                  : "bg-blue-500/10 border-blue-500/30 text-blue-500 hover:bg-blue-500/20"
              }`}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 flex-shrink-0">
                <path d="M8 15A7 7 0 118 1a7 7 0 010 14zm0-1A6 6 0 108 2a6 6 0 000 12zM7.002 11V7h1.996v4H7.002zm0-5.5V4h1.996v1.5H7.002z"/>
              </svg>
              Тайлбар
            </button>
          )}
          {/* Chart type switcher */}
          <div className="flex bg-background border border-border rounded text-[9px]">
            {compatible.slice(0, 5).map((t) => (
              <button
                key={t}
                onClick={() => setUserType(t)}
                className={`px-1.5 py-0.5 transition-colors ${effectiveType === t ? "bg-foreground/10 text-foreground font-semibold" : "text-foreground/50 hover:text-foreground/80"}`}
                title={CHART_LABELS[t]}
              >
                {({ bar: "▇", horizontal_bar: "≡", line: "╱", area: "◢", pie: "◉", donut: "◎", combo: "⊞", stacked_bar: "▤", heatmap: "▦", scatter: "⁘", waterfall: "▯" } as Record<ChartType, string>)[t]}
              </button>
            ))}
            {compatible.length > 5 && (
              <select
                value={effectiveType}
                onChange={(e) => setUserType(e.target.value as ChartType)}
                className="bg-transparent border-none text-[9px] text-foreground/70 outline-none cursor-pointer px-1"
              >
                {compatible.map((t) => (
                  <option key={t} value={t}>{CHART_LABELS[t]}</option>
                ))}
              </select>
            )}
          </div>
          {/* Export */}
          <button onClick={handleExport} className="w-6 h-6 flex items-center justify-center rounded text-foreground/40 hover:text-foreground/70 hover:bg-foreground/8 transition-colors" title="PNG татах">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
              <path d="M.5 9.9a.5.5 0 01.5.5v2.5a1 1 0 001 1h12a1 1 0 001-1v-2.5a.5.5 0 011 0v2.5a2 2 0 01-2 2H2a2 2 0 01-2-2v-2.5a.5.5 0 01.5-.5z"/>
              <path d="M7.646 11.854a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 10.293V1.5a.5.5 0 00-1 0v8.793L5.354 8.146a.5.5 0 10-.708.708l3 3z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Тайлбар panel ── */}
      {infoOpen && description && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2.5 bg-blue-500/8 border border-blue-500/20 rounded-lg">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-blue-500 flex-shrink-0 mt-0.5">
            <path d="M8 15A7 7 0 118 1a7 7 0 010 14zm0-1A6 6 0 108 2a6 6 0 000 12zM7.002 11V7h1.996v4H7.002zm0-5.5V4h1.996v1.5H7.002z"/>
          </svg>
          <p className="text-[10px] text-foreground/70 leading-relaxed">{description}</p>
        </div>
      )}
      {/* Ant-design-pro SalesCard style: horizontal_bar gets a rank list on the right */}
      {effectiveType === "horizontal_bar" && rows.length > 0 ? (
        <div className="flex gap-3">
          <div className="flex-1 h-52 relative">
            <ResponsiveContainer width="100%" height="100%">
              {renderChartContent(effectiveType)}
            </ResponsiveContainer>
          </div>
          <div className="w-36 flex-shrink-0 border-l border-border/30 pl-3 pt-1 overflow-y-auto">
            <div className="text-[9px] font-bold text-foreground/40 uppercase tracking-wider mb-2">Жагсаалт</div>
            <RankList items={(rows as any[]).map((r) => ({ label: String(r.label ?? ""), value: Number(r.value) || 0 })).sort((a, b) => b.value - a.value).slice(0, 8)} />
          </div>
        </div>
      ) : (
      <div className="h-52 w-full relative">
        <ResponsiveContainer width="100%" height="100%">
          {renderChartContent(effectiveType)}
        </ResponsiveContainer>
        {drillDown && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setDrillDown(null)} />
            <div
              style={{
                ...chartTheme.tooltip.contentStyle,
                position: "absolute",
                left: Math.min(drillDown.x, 200),
                top: Math.max(drillDown.y, 0),
                pointerEvents: "auto",
                whiteSpace: "nowrap",
                zIndex: 50,
                padding: "6px 10px",
                borderRadius: "6px",
                cursor: "pointer",
              }}
              onClick={() => setDrillDown(null)}
            >
              <div className="text-[11px] font-semibold">{drillDown.label}</div>
              <div className="text-[10px] text-foreground/70 mt-0.5">{fmtFull(drillDown.value)}</div>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
};

export const DashboardWidget = ({ widget }: { widget: any }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [heatmapTip, setHeatmapTip] = useState<{ label: string; value: number; x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  if (widget.type === "kpi") {
    const val = widget.value != null ? Number(widget.value) : null;
    const isPositive = val != null && val >= 0;
    const accentColor = widget.color || (isPositive ? "#3b82f6" : "#ef4444");
    return (
      <div className="bg-card border border-border/60 rounded-xl p-3 flex items-start gap-2.5 shadow-sm hover:shadow-md transition-shadow duration-150">
        {/* Ant-design-pro style avatar */}
        <div
          className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-[14px] font-bold"
          style={{ backgroundColor: `${accentColor}18`, color: accentColor }}
        >
          {widget.icon || (val != null && val >= 0 ? "↑" : "↓")}
        </div>
        <div className="min-w-0">
          <div className="text-[9px] text-foreground/50 uppercase tracking-wider font-semibold truncate">{widget.title}</div>
          <div className="text-xl font-extrabold tracking-tight mt-0.5" style={{ color: accentColor }}>
            {val != null ? fmtFull(val) : "—"}
            {widget.unit && <span className="text-[9px] text-foreground/50 ml-1 font-normal">{widget.unit}</span>}
          </div>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="bg-gradient-to-br from-background to-sidebar border border-border/80 rounded-lg p-3 shadow-sm">
        <ChartSkeleton />
      </div>
    );
  }

  if (!widget.data || !Array.isArray(widget.data) || widget.data.length === 0) {
    return (
      <div className="bg-gradient-to-br from-background to-sidebar border border-border/80 rounded-lg p-3 shadow-sm">
        <div className="text-[9px] font-bold text-foreground/50 uppercase mb-2 tracking-wider">{widget.title}</div>
        <ChartEmptyState message={widget.error || undefined} />
      </div>
    );
  }

  const colors = DEFAULT_COLORS;
  const gridStyle = { stroke: "var(--border)", strokeOpacity: 0.4, strokeDasharray: "3 3" };

  const renderChart = () => {
    switch (widget.type) {
      case "bar":
        return (
          <BarChart data={widget.data}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Bar dataKey="value" fill={colors[0]} radius={[3, 3, 0, 0]} />
          </BarChart>
        );
      case "horizontal_bar":
        return (
          <BarChart data={widget.data} layout="vertical">
            <CartesianGrid {...gridStyle} horizontal={false} />
            <XAxis type="number" stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} />
            <YAxis dataKey="label" type="category" stroke="#888888" fontSize={chartTheme.font.sizes.axis} width={90} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Bar dataKey="value" fill={colors[0]} radius={[0, 3, 3, 0]} />
          </BarChart>
        );
      case "line":
        return (
          <LineChart data={widget.data}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Line type="monotone" dataKey="value" stroke={colors[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        );
      case "area":
        return (
          <AreaChart data={widget.data}>
            <defs>
              <linearGradient id="areaGradientW0" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors[0]} stopOpacity={0.25} />
                <stop offset="95%" stopColor={colors[0]} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Area type="monotone" dataKey="value" fill="url(#areaGradientW0)" stroke={colors[0]} strokeWidth={2} />
          </AreaChart>
        );
      case "donut":
      case "pie":
        return (
          <PieChart>
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Pie
              data={widget.data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={60}
              innerRadius={widget.type === "donut" ? 25 : 0}
              label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""}: ${fmtCompact(Number(value ?? 0))}`}
              labelLine={false}
            >
              {widget.data.map((_: any, i: number) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Legend wrapperStyle={{ fontSize: `${chartTheme.font.sizes.legend}px` }} />
          </PieChart>
        );
      case "combo":
        return (
          <ComposedChart data={widget.data}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Legend wrapperStyle={{ fontSize: `${chartTheme.font.sizes.legend}px` }} />
            <Bar dataKey="value" fill={colors[0]} radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey="lineValue" stroke={colors[1]} strokeWidth={2} dot={false} />
          </ComposedChart>
        );
      case "stacked_bar":
        return (
          <BarChart data={widget.data}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} tickFormatter={fmtCompact} width={52} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} formatter={tooltipFormatter} />
            <Legend wrapperStyle={{ fontSize: `${chartTheme.font.sizes.legend}px` }} />
            {colors.slice(0, 4).map((color, i) => (
              <Bar key={i} dataKey={["value", "value2", "value3", "value4"][i] || "value"} fill={color} stackId="auto" radius={i === 3 ? [3, 3, 0, 0] : undefined} />
            ))}
          </BarChart>
        );
      case "heatmap":
        return (
          <div className="relative w-full h-full">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-0.5 w-full h-full">
              {widget.data.map((row: any, i: number) => {
                const val = parseFloat(row.value) || 0;
                const maxVal = Math.max(...widget.data.map((r: any) => parseFloat(r.value) || 0), 1);
                const intensity = Math.min(val / maxVal, 1);
                const colorIndex = Math.floor((1 - intensity) * (colors.length - 1));
                return (
                  <div
                    key={i}
                    className="flex items-center justify-center text-[7px] text-white rounded cursor-pointer"
                    style={{ backgroundColor: colors[Math.min(colorIndex, colors.length - 1)], aspectRatio: "1" }}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const parent = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
                      setHeatmapTip({ label: row.label, value: val, x: rect.left - (parent?.left || 0), y: rect.top - (parent?.top || 0) - 28 });
                    }}
                    onMouseLeave={() => setHeatmapTip(null)}
                  >
                    {String(row.label).slice(0, 3)}
                  </div>
                );
              })}
            </div>
            {heatmapTip && (
              <div
                style={{
                  ...chartTheme.tooltip.contentStyle,
                  position: "absolute",
                  left: heatmapTip.x,
                  top: heatmapTip.y,
                  pointerEvents: "none",
                  whiteSpace: "nowrap",
                  zIndex: 50,
                }}
              >
                {heatmapTip.label}: {fmtFull(heatmapTip.value)}
              </div>
            )}
          </div>
        );
      case "table":
        // Table widget: renders data as a sortable, styled HTML table
        return (
          <div className="overflow-auto h-full max-h-44">
            <table className="w-full text-[9px] border-collapse">
              <thead>
                <tr className="bg-foreground/5">
                  {widget.data[0] && Object.keys(widget.data[0]).filter(k => k !== "value").map((key) => (
                    <th key={key} className="px-2 py-1 text-left font-semibold text-foreground/70 border-b border-border/30 sticky top-0 bg-card">
                      {key}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right font-semibold text-foreground/70 border-b border-border/30 sticky top-0 bg-card">
                    Утга
                  </th>
                </tr>
              </thead>
              <tbody>
                {widget.data.slice(0, 20).map((row: any, i: number) => (
                  <tr key={i} className={`${i % 2 === 0 ? "bg-transparent" : "bg-foreground/3"} hover:bg-foreground/5 transition-colors`}>
                    {Object.keys(row).filter(k => k !== "value").map((key) => (
                      <td key={key} className="px-2 py-1 text-foreground/70 border-b border-border/20">
                        {String(row[key] ?? "")}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right font-semibold text-foreground/80 border-b border-border/20 tabular-nums">
                      {fmtFull(Number(row.value) || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {widget.data.length > 20 && (
              <div className="text-[8px] text-foreground/40 text-center py-1">
                +{widget.data.length - 20} мөр илүү...
              </div>
            )}
          </div>
        );
      default:
        return null;
    <div className="bg-card border border-border/60 rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow duration-150" ref={chartRef}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="block w-0.5 h-3.5 rounded-full flex-shrink-0 bg-blue-500" />
          <h5 className="text-[10px] font-semibold text-foreground/70 uppercase tracking-wide truncate">{widget.title}</h5>
        </div>
        {widget.description && (
          <button
            onClick={() => setInfoOpen(v => !v)}
            title="Тайлбар харах"
            className={`flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border transition-all duration-150 ${
              infoOpen
                ? "bg-blue-500 border-blue-500 text-white"
                : "bg-blue-500/10 border-blue-500/30 text-blue-500 hover:bg-blue-500/20"
            }`}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5">
              <path d="M8 15A7 7 0 118 1a7 7 0 010 14zm0-1A6 6 0 108 2a6 6 0 000 12zM7.002 11V7h1.996v4H7.002zm0-5.5V4h1.996v1.5H7.002z"/>
            </svg>
            Тайлбар
          </button>
        )}
      </div>
      {/* Description panel */}
      {infoOpen && widget.description && (
        <div className="mb-2 flex items-start gap-2 px-2.5 py-2 bg-blue-500/8 border border-blue-500/20 rounded-lg">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-blue-500 flex-shrink-0 mt-0.5">
            <path d="M8 15A7 7 0 118 1a7 7 0 010 14zm0-1A6 6 0 108 2a6 6 0 000 12zM7.002 11V7h1.996v4H7.002zm0-5.5V4h1.996v1.5H7.002z"/>
          </svg>
          <p className="text-[10px] text-foreground/70 leading-relaxed">{widget.description}</p>
        </div>
      )}
      <div className="h-44 w-full min-w-0" style={{ minHeight: "176px" }}>
        {ready && (
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export const VisualGrid = ({ items }: { items: { type: "visual" | "dashboard"; json: string }[] }) => {
  const visualCount = items.filter(i => i.type === "visual").length;
  const dashCount = items.filter(i => i.type === "dashboard").length;
  const total = items.length;

  const gridCols = total <= 2 ? "grid-cols-1 sm:grid-cols-2" :
    total <= 4 ? "grid-cols-1 sm:grid-cols-2" :
    "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className={`grid ${gridCols} gap-3 mt-3`}>
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          {item.type === "visual" ? (
            <VisualMessage visualJson={item.json} />
          ) : (
            <DashboardMessage dashboardJson={item.json} />
          )}
        </div>
      ))}
    </div>
  );
};

export const DashboardMessage = ({ dashboardJson }: { dashboardJson: string }) => {
  let widgets: any[];
  try {
    widgets = JSON.parse(dashboardJson);
  } catch (e) {
    return <div className="text-[9px] text-red-500">Failed to render dashboard: {String(e)}</div>;
  }

  if (!Array.isArray(widgets) || widgets.length === 0) {
    return <div className="text-[9px] text-red-500">Invalid dashboard data</div>;
  }

  return (
    <div className="bg-card border border-border/60 rounded-xl p-4 mt-2 max-w-3xl shadow-sm transition-colors duration-200">
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border/40">
        {/* Ant-design-pro style accent stripe */}
        <div className="w-0.5 h-4 rounded-full bg-blue-500" />
        <h4 className="text-[11px] font-bold text-foreground/60 uppercase tracking-widest">Dashboard</h4>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4">
        {widgets.filter((w: any) => w.type === "kpi").map((w: any, i: number) => (
          <DashboardWidget key={`kpi-${i}`} widget={w} />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {widgets.filter((w: any) => w.type !== "kpi").map((w: any, i: number) => (
          <DashboardWidget key={`chart-${i}`} widget={w} />
        ))}
      </div>
    </div>
  );
};
