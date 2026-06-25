"use client";

import React, { useState, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, Legend, ComposedChart } from "recharts";
import { chartTheme, type ChartType } from "./chartTheme";
import { DEFAULT_COLORS } from "./types";

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
};

export function getCompatibleTypes(series: string[] | undefined, hasMultiNumeric: boolean): ChartType[] {
  const base: ChartType[] = ["bar", "horizontal_bar", "line", "area", "pie", "donut", "heatmap"];
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
  const effectiveType: ChartType = userType || (data.type as ChartType) || "bar";
  const hasMultiNumeric = data.data.some((r: any) =>
    Object.keys(r).filter(k => k !== "label").length > 1
  );
  const compatible = getCompatibleTypes(series, hasMultiNumeric);

  const renderMultiSeries = (ChartComponent: any, DataComponent: any, extraProps?: Record<string, unknown>) => {
    const s = series || ["value"];
    return (
      <ChartComponent data={rows} layout={extraProps?.layout || undefined}>
        {extraProps?.layout === "vertical" ? null : <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />}
        {extraProps?.layout === "vertical" ? <YAxis dataKey="label" type="category" stroke="#888888" fontSize={chartTheme.font.sizes.axis} /> : <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />}
        {extraProps?.layout === "vertical" ? <XAxis type="number" stroke="#888888" fontSize={chartTheme.font.sizes.axis} /> : null}
        <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
        {s.length > 1 && <Legend wrapperStyle={{ fontSize: `${chartTheme.font.sizes.legend}px` }} />}
        {s.map((key, i) => (
          <DataComponent key={key} type="monotone" dataKey={key} fill={colors[i % colors.length]} stroke={colors[i % colors.length]} stackId={stacked ? "stack" : undefined} />
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
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Bar dataKey="value" fill={colors[0]} />
          </BarChart>
        );
      case "horizontal_bar":
        return series && series.length > 1 ? renderMultiSeries(BarChart, Bar, { layout: "vertical" }) : (
          <BarChart data={rows} layout="vertical" onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <XAxis type="number" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis dataKey="label" type="category" stroke="#888888" fontSize={chartTheme.font.sizes.axis} width={80} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Bar dataKey="value" fill={colors[0]} />
          </BarChart>
        );
      case "line":
        return series && series.length > 1 ? renderMultiSeries(LineChart, Line) : (
          <LineChart data={rows} onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Line type="monotone" dataKey="value" stroke={colors[0]} />
          </LineChart>
        );
      case "area":
        return series && series.length > 1 ? renderMultiSeries(AreaChart, Area) : (
          <AreaChart data={rows} onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Area type="monotone" dataKey="value" fill={colors[0]} stroke={colors[0]} fillOpacity={0.3} />
          </AreaChart>
        );
      case "donut":
      case "pie":
        return (
          <PieChart onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: 100, y: 60 }); }}>
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Pie data={rows} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={70} innerRadius={chartType === "donut" ? 30 : 0} label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""}: ${value ?? 0}`}>
              {rows.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
          </PieChart>
        );
      case "combo":
        return (
          <ComposedChart data={rows} onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Legend wrapperStyle={{ fontSize: `${chartTheme.font.sizes.legend}px` }} />
            <Bar dataKey="value" fill={colors[0]} />
            <Line type="monotone" dataKey={series?.[1] || "lineValue"} stroke={colors[1]} strokeWidth={2} />
          </ComposedChart>
        );
      case "stacked_bar":
        return series && series.length > 1 ? renderMultiSeries(BarChart, Bar) : (
          <BarChart data={rows} onClick={(data: any) => { const r = maybeRow(data); if (r) setDrillDown({ ...r, x: data.chartX || 0, y: (data.chartY || 0) - 8 }); }}>
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Bar dataKey="value" fill={colors[0]} stackId="auto" />
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
                {heatmapTip.label}: {heatmapTip.value}
              </div>
            )}
          </div>
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
    <div className="bg-sidebar border border-border rounded-lg p-4 mt-2 max-w-full sm:max-w-lg transition-colors duration-200" ref={chartRef}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[10px] font-bold text-foreground/60 uppercase">{data.title || "Дүн шинжилгээ"}</h4>
        <div className="flex items-center gap-1.5">
          <div className="flex bg-background border border-border rounded text-[9px]">
            {compatible.slice(0, 5).map((t) => (
              <button
                key={t}
                onClick={() => setUserType(t)}
                className={`px-1.5 py-0.5 transition-colors ${effectiveType === t ? "bg-foreground/10 text-foreground font-semibold" : "text-foreground/50 hover:text-foreground/80"}`}
                title={CHART_LABELS[t]}
              >
                {({ bar: "▇", horizontal_bar: "≡", line: "╱", area: "◢", pie: "◉", donut: "◎", combo: "⊞", stacked_bar: "▤", heatmap: "▦" } as Record<ChartType, string>)[t]}
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
          <button onClick={handleExport} className="text-[9px] text-foreground/40 hover:text-foreground/70 px-1" title="PNG татах">
            ⬇
          </button>
        </div>
      </div>
      <div className="h-48 w-full relative">
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
              <div className="text-[10px] text-foreground/70 mt-0.5">{chartTheme.format.number(drillDown.value)}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const DashboardWidget = ({ widget }: { widget: any }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [heatmapTip, setHeatmapTip] = useState<{ label: string; value: number; x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  if (widget.type === "kpi") {
    const val = widget.value != null ? Number(widget.value) : null;
    const isLarge = val != null && val >= 10000;
    return (
      <div className="bg-gradient-to-br from-background to-sidebar border border-border/80 rounded-lg p-3 flex flex-col justify-center shadow-sm hover:shadow-md transition-shadow duration-150">
        <div className="text-[9px] text-foreground/50 uppercase tracking-wider font-semibold">{widget.title}</div>
        <div className={`${isLarge ? "text-2xl" : "text-xl"} font-bold text-foreground mt-1 tracking-tight`}>
          {val != null ? val.toLocaleString() : "—"}
          {widget.unit && <span className="text-[10px] text-foreground/50 ml-1 font-normal">{widget.unit}</span>}
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

  const renderChart = () => {
    switch (widget.type) {
      case "bar":
        return (
          <BarChart data={widget.data}>
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Bar dataKey="value" fill={colors[0]} />
          </BarChart>
        );
      case "horizontal_bar":
        return (
          <BarChart data={widget.data} layout="vertical">
            <XAxis type="number" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis dataKey="label" type="category" stroke="#888888" fontSize={chartTheme.font.sizes.axis} width={80} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Bar dataKey="value" fill={colors[0]} />
          </BarChart>
        );
      case "line":
        return (
          <LineChart data={widget.data}>
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Line type="monotone" dataKey="value" stroke={colors[0]} />
          </LineChart>
        );
      case "area":
        return (
          <AreaChart data={widget.data}>
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Area type="monotone" dataKey="value" fill={colors[0]} stroke={colors[0]} fillOpacity={0.3} />
          </AreaChart>
        );
      case "donut":
      case "pie":
        return (
          <PieChart>
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Pie data={widget.data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={60} innerRadius={widget.type === "donut" ? 25 : 0} label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""}: ${value ?? 0}`}>
              {widget.data.map((_: any, i: number) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
          </PieChart>
        );
      case "combo":
        return (
          <ComposedChart data={widget.data}>
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Legend wrapperStyle={{ fontSize: `${chartTheme.font.sizes.legend}px` }} />
            <Bar dataKey="value" fill={colors[0]} />
            <Line type="monotone" dataKey="lineValue" stroke={colors[1]} strokeWidth={2} />
          </ComposedChart>
        );
      case "stacked_bar":
        return (
          <BarChart data={widget.data}>
            <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
            <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
            <Legend wrapperStyle={{ fontSize: `${chartTheme.font.sizes.legend}px` }} />
            {colors.slice(0, 4).map((color, i) => (
              <Bar key={i} dataKey={["value", "value2", "value3", "value4"][i] || "value"} fill={color} stackId="auto" />
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
                {heatmapTip.label}: {heatmapTip.value}
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-gradient-to-br from-background to-sidebar border border-border/80 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow duration-150" ref={chartRef}>
      <h5 className="text-[9px] font-bold text-foreground/50 uppercase mb-2 tracking-wider">{widget.title}</h5>
      <div className="h-40 w-full min-w-0" style={{ minHeight: "160px" }}>
        {ready && (
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        )}
      </div>
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
    <div className="bg-gradient-to-br from-sidebar to-background border border-border/80 rounded-xl p-4 mt-2 max-w-3xl shadow-sm transition-colors duration-200">
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border/50">
        <div className="w-1.5 h-1.5 rounded-full bg-foreground/30" />
        <h4 className="text-[10px] font-bold text-foreground/50 uppercase tracking-widest">Dashboard</h4>
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
