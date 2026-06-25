"use client";

import React, { useState, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, Legend, ComposedChart } from "recharts";
import { chartTheme, type ChartType } from "./chartTheme";
import { DEFAULT_COLORS } from "./types";

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

export const VisualMessage = ({ visualJson }: { visualJson: string }) => {
  const sanitizedJson = sanitizeVisualJson(visualJson);
  const [heatmapTip, setHeatmapTip] = useState<{ label: string; value: number; x: number; y: number } | null>(null);

  let data: { title?: string; type?: string; data?: Record<string, unknown>[]; config?: Record<string, unknown> };
  try {
    data = JSON.parse(sanitizedJson);
  } catch (e) {
    console.error("Visual JSON Parse Error:", e);
    return <div className="text-[9px] text-red-500">Failed to render graphic: {String(e)}</div>;
  }

  if (!data.data || !Array.isArray(data.data)) {
    return <div className="text-[9px] text-red-500">Invalid data format</div>;
  }

  const config = data.config || {};
  const colors = (config.colors as string[]) || DEFAULT_COLORS;
  const series = config.series as string[] | undefined;
  const stacked = config.stacked === true;

  const renderMultiSeries = (ChartComponent: any, DataComponent: any, extraProps?: Record<string, unknown>) => {
    const s = series || ["value"];
    return (
      <ChartComponent data={data.data} layout={extraProps?.layout || undefined}>
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

  return (
    <div className="bg-sidebar border border-border rounded-lg p-4 mt-2 max-w-lg transition-colors duration-200">
      <h4 className="text-[10px] font-bold text-foreground/60 uppercase mb-3">{data.title}</h4>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {data.type === "bar" ? (
            stacked ? renderMultiSeries(BarChart, Bar) : series && series.length > 1 ? renderMultiSeries(BarChart, Bar) : (
              <BarChart data={data.data}>
                <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
                <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
                <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
                <Bar dataKey="value" fill={colors[0]} />
              </BarChart>
            )
          ) : data.type === "horizontal_bar" ? (
            series && series.length > 1 ? renderMultiSeries(BarChart, Bar, { layout: "vertical" }) : (
              <BarChart data={data.data} layout="vertical">
                <XAxis type="number" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
                <YAxis dataKey="label" type="category" stroke="#888888" fontSize={chartTheme.font.sizes.axis} width={80} />
                <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
                <Bar dataKey="value" fill={colors[0]} />
              </BarChart>
            )
          ) : data.type === "line" ? (
            series && series.length > 1 ? renderMultiSeries(LineChart, Line) : (
              <LineChart data={data.data}>
                <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
                <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
                <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
                <Line type="monotone" dataKey="value" stroke={colors[0]} />
              </LineChart>
            )
          ) : data.type === "area" ? (
            series && series.length > 1 ? renderMultiSeries(AreaChart, Area) : (
              <AreaChart data={data.data}>
                <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
                <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
                <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
                <Area type="monotone" dataKey="value" fill={colors[0]} stroke={colors[0]} fillOpacity={0.3} />
              </AreaChart>
            )
          ) : data.type === "donut" || data.type === "pie" ? (
            <PieChart>
              <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
              <Pie data={data.data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={70} innerRadius={data.type === "donut" ? 30 : 0} label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""}: ${value ?? 0}`}>
                {data.data.map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : data.type === "combo" ? (
            <ComposedChart data={data.data}>
              <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
              <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
              <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
              <Legend wrapperStyle={{ fontSize: `${chartTheme.font.sizes.legend}px` }} />
              <Bar dataKey="value" fill={colors[0]} />
              <Line type="monotone" dataKey={series?.[1] || "lineValue"} stroke={colors[1]} strokeWidth={2} />
            </ComposedChart>
          ) : data.type === "stacked_bar" ? (
            series && series.length > 1 ? renderMultiSeries(BarChart, Bar) : (
              <BarChart data={data.data}>
                <XAxis dataKey="label" stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
                <YAxis stroke="#888888" fontSize={chartTheme.font.sizes.axis} />
                <Tooltip contentStyle={chartTheme.tooltip.contentStyle} />
                <Bar dataKey="value" fill={colors[0]} stackId="auto" />
              </BarChart>
            )
          ) : data.type === "heatmap" ? (
            <div className="relative w-full h-full">
              <div className="grid grid-cols-6 gap-0.5 w-full h-full">
                {(data.data as Record<string, unknown>[]).map((row: any, i: number) => {
                  const val = parseFloat(row.value) || 0;
                  const maxVal = Math.max(...(data.data as Record<string, unknown>[]).map((r: any) => parseFloat(r.value) || 0), 1);
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
          ) : null}
        </ResponsiveContainer>
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

  if (!widget.data || !Array.isArray(widget.data) || widget.data.length === 0) {
    return (
      <div className="bg-gradient-to-br from-background to-sidebar border border-border/80 rounded-lg p-3 shadow-sm">
        <div className="text-[9px] font-bold text-foreground/50 uppercase mb-2 tracking-wider">{widget.title}</div>
        <div className="text-[9px] text-foreground/40">{widget.error || "No data"}</div>
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
            <div className="grid grid-cols-6 gap-0.5 w-full h-full">
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
