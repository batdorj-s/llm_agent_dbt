import { getPool } from "../db/data-lake.js";
import { computeMetrics } from "./reportMetrics.js";
import { getRepository } from "../db/kpi-repository.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import path from "path";
import fs from "fs";

function formatCurrency(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

// ── PDF Report ─────────────────────────────────────────────────────────

export async function generateReportPdf(userId: string): Promise<Buffer> {
  const [metrics, repo] = await Promise.all([computeMetrics(userId), getRepository()]);
  const [history, salesKpi, usersKpi, churnKpi] = await Promise.all([
    repo.getSalesHistory(12),
    repo.getKpi("sales"),
    repo.getKpi("users"),
    repo.getKpi("churn_rate"),
  ]);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([612, 792]);
  const { width } = page.getSize();
  let y = 750;
  const margin = 50;
  const col1 = margin;
  const col2 = 220;

  function text(msg: string, size: number, opts?: { bold?: boolean; color?: number[]; x?: number }) {
    const f = opts?.bold ? bold : font;
    const x = opts?.x ?? col1;
    page.drawText(msg, { x, y, size, font: f, color: rgb(opts?.color?.[0] ?? 0.2, opts?.color?.[1] ?? 0.2, opts?.color?.[2] ?? 0.2) });
  }

  function line() {
    y -= 4;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 8;
  }

  // Title
  text("SALES REPORT", 16, { bold: true, color: [0, 0, 0] }); y -= 20;
  text(`Generated: ${new Date().toISOString().split("T")[0]}`, 9); y -= 24;

  // KPI Summary
  text("KPI SUMMARY", 12, { bold: true }); y -= 18;

  const hyphen = "-";
  const kpiRows = [
    ["Sales Revenue", salesKpi ? formatCurrency(salesKpi.current) : hyphen],
    ["Active Users", usersKpi ? formatNumber(usersKpi.current) : hyphen],
    ["Churn Rate", churnKpi ? `${churnKpi.current}%` : hyphen],
    ["Avg Order Value", metrics ? formatCurrency(metrics.aov) : hyphen],
    ["Growth Rate", metrics ? `${metrics.growthRate.toFixed(1)}%` : hyphen],
    ["Top Category", metrics?.topCategory ?? hyphen],
  ];

  for (const [label, value] of kpiRows) {
    text(label, 9, { bold: true }); text(value, 9, { x: col2 }); y -= 14;
  }

  y -= 10;
  line();

  // Sales History Table
  text("SALES HISTORY", 12, { bold: true }); y -= 18;

  if (history.length > 0) {
    const tableLeft = margin;
    const tableRight = width - margin;
    const colW = (tableRight - tableLeft) / 3;

    // Header
    page.drawText("Month", { x: tableLeft, y, size: 9, font: bold, color: rgb(0.3, 0.3, 0.3) });
    page.drawText("Revenue", { x: tableLeft + colW, y, size: 9, font: bold, color: rgb(0.3, 0.3, 0.3) });
    page.drawText("Change", { x: tableLeft + colW * 2, y, size: 9, font: bold, color: rgb(0.3, 0.3, 0.3) });
    y -= 12;
    line();

    for (let i = 0; i < history.length; i++) {
      const row = history[i];
      const prev = i > 0 ? history[i - 1].revenue : row.revenue;
      const change = prev > 0 ? ((row.revenue - prev) / prev * 100) : 0;

      page.drawText(row.month, { x: tableLeft, y, size: 8, font, color: rgb(0.3, 0.3, 0.3) });
      page.drawText(formatCurrency(row.revenue), { x: tableLeft + colW, y, size: 8, font, color: rgb(0.3, 0.3, 0.3) });
      page.drawText(i > 0 ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : hyphen, { x: tableLeft + colW * 2, y, size: 8, font, color: rgb(0.3, 0.3, 0.3) });

      y -= 11;
      if (y < 60) break;
    }
  } else {
    text("No sales history available.", 9); y -= 14;
  }

  // Footer
  page.drawText(`Report generated on ${new Date().toISOString().split("T")[0]}`, {
    x: margin, y: 30, size: 7, font, color: rgb(0.6, 0.6, 0.6),
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

// ── Excel Report ────────────────────────────────────────────────────────

export async function generateReportXlsx(userId: string): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const mod = (XLSX as any).default || XLSX;

  const [metrics, repo] = await Promise.all([computeMetrics(userId), getRepository()]);
  const [history, salesKpi, usersKpi, churnKpi] = await Promise.all([
    repo.getSalesHistory(12),
    repo.getKpi("sales"),
    repo.getKpi("users"),
    repo.getKpi("churn_rate"),
  ]);

  const wb = mod.utils.book_new();

  // Sheet 1: Tailan (Summary)
  const summaryData = [
    ["Borluulaltyn Tailan", ""],
    ["Uüsgegdsen:", new Date().toISOString().split("T")[0]],
    [],
    ["KPI", "Current", "Target"],
    ["Sales Revenue", salesKpi?.current ?? "—", salesKpi?.target ?? "—"],
    ["Active Users", usersKpi?.current ?? "—", usersKpi?.target ?? "—"],
    ["Churn Rate (%)", churnKpi?.current ?? "—", churnKpi?.target ?? "—"],
    ["Avg Order Value", metrics?.aov ?? "—", ""],
    ["Growth Rate (%)", metrics?.growthRate ?? "—", ""],
    ["Top Category", metrics?.topCategory ?? "—", ""],
  ];
  const ws1 = mod.utils.aoa_to_sheet(summaryData);
  ws1["!cols"] = [{ wch: 25 }, { wch: 15 }, { wch: 15 }];
  mod.utils.book_append_sheet(wb, ws1, "Tailan");

  // Sheet 2: Borluulalt (Sales History)
  if (history.length > 0) {
    const historyData = [
      ["Sar", "Orlogo", "Oörchlolt (%)"],
      ...history.map((row, i) => {
        const prev = i > 0 ? history[i - 1].revenue : row.revenue;
        const change = prev > 0 ? ((row.revenue - prev) / prev * 100) : 0;
        return [row.month, row.revenue, i > 0 ? Number(change.toFixed(1)) : "—"];
      }),
    ];
    const ws2 = mod.utils.aoa_to_sheet(historyData);
    ws2["!cols"] = [{ wch: 20 }, { wch: 15 }, { wch: 15 }];
    mod.utils.book_append_sheet(wb, ws2, "Borluulalt");
  }

  const buffer = mod.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buffer;
}
