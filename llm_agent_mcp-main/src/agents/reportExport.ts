import { getPool, getActiveCatalogEntry, quoteIdent } from "../db/data-lake.js";
import { computeMetrics } from "./reportMetrics.js";
import { getRepository } from "../db/kpi-repository.js";
import { findConceptColumn } from "./columnSynonyms.js";
import { buildMntAmountExpr } from "../utils/sqlHelpers.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import path from "path";
import fs from "fs";

function formatCurrency(value: number): string {
  return `₮${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// PDF-safe: Helvetica uses WinAnsi which cannot encode ₮ (U+20AE)
function formatCurrencyPdf(value: number): string {
  return `MNT ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

// ── PDF Report ─────────────────────────────────────────────────────────

async function getFinanceReportData(userId: string, startDate?: string, endDate?: string) {
  const entry = await getActiveCatalogEntry(userId);
  if (!entry) return null;
  const cols: string[] = JSON.parse(entry.columns_info);
  const amtCol = findConceptColumn(cols, "finance_amount", entry.table_name);
  const catCol = findConceptColumn(cols, "finance_category", entry.table_name);
  const subCatCol = findConceptColumn(cols, "finance_subcategory", entry.table_name);
  const dateCol = findConceptColumn(cols, "finance_date", entry.table_name);
  if (!amtCol || !catCol) return null;

  const qTbl = quoteIdent(entry.table_name);
  const qAmt = buildMntAmountExpr(quoteIdent(amtCol));
  const qCat = quoteIdent(catCol);
  const qSubCat = subCatCol ? quoteIdent(subCatCol) : null;
  const isOpIncome  = `(${qCat} ILIKE '%орлого%' AND ${qCat} NOT ILIKE '%зээл%')`;
  const isOpExpense = qSubCat
    ? `(${qCat} ILIKE '%зарлага%' AND ${qSubCat} NOT ILIKE '%зээл%' AND ${qSubCat} NOT ILIKE '%бусад%')`
    : `${qCat} ILIKE '%зарлага%'`;

  let dateWhere = "";
  const dParams: any[] = [];
  if (dateCol && (startDate || endDate)) {
    const qDate = quoteIdent(dateCol);
    if (startDate) { dParams.push(startDate); dateWhere += ` AND ${qDate} >= $${dParams.length}`; }
    if (endDate)   { dParams.push(endDate);   dateWhere += ` AND ${qDate} <= $${dParams.length}`; }
  }

  const [incomeRes, expenseRes, monthlyRes] = await Promise.all([
    getPool().query(`SELECT COALESCE(SUM(${qAmt}), 0) AS total FROM ${qTbl} WHERE ${isOpIncome}${dateWhere}`, dParams),
    getPool().query(`SELECT COALESCE(SUM(${qAmt}), 0) AS total FROM ${qTbl} WHERE ${isOpExpense}${dateWhere}`, dParams),
    dateCol ? getPool().query(`
      SELECT TO_CHAR(DATE_TRUNC('month', ${quoteIdent(dateCol)}), 'Mon YYYY') AS month,
             SUM(CASE WHEN ${isOpIncome} THEN ${qAmt} ELSE 0 END) AS revenue
      FROM ${qTbl}
      WHERE ${qCat} NOT ILIKE '%шилжүүлэг%'${dateWhere}
      GROUP BY 1, DATE_TRUNC('month', ${quoteIdent(dateCol)})
      ORDER BY DATE_TRUNC('month', ${quoteIdent(dateCol)})`, dParams) : null,
  ]);

  const totalIncome  = Number(incomeRes.rows[0]?.total || 0);
  const totalExpense = Number(expenseRes.rows[0]?.total || 0);
  const history = (monthlyRes?.rows ?? []).map((r: any) => ({ month: r.month, revenue: Number(r.revenue || 0) }));

  return { totalIncome, totalExpense, netProfit: totalIncome - totalExpense, history };
}

export async function generateReportPdf(userId: string, startDate?: string, endDate?: string): Promise<Buffer> {
  const dateFilter = { startDate, endDate };
  const [metrics, financeData, repo] = await Promise.all([
    computeMetrics(userId, startDate, endDate),
    getFinanceReportData(userId, startDate, endDate),
    getRepository(),
  ]);
  const [history, salesKpi, usersKpi, churnKpi] = financeData
    ? [financeData.history, null, null, null]
    : await Promise.all([
        repo.getSalesHistory(12, dateFilter),
        repo.getKpi("sales", dateFilter),
        repo.getKpi("users", dateFilter),
        repo.getKpi("churn_rate", dateFilter),
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
  const reportTitle = financeData ? "FINANCIAL REPORT" : "SALES REPORT";
  text(reportTitle, 16, { bold: true, color: [0, 0, 0] }); y -= 20;
  text(`Generated: ${new Date().toISOString().split("T")[0]}`, 9); y -= 24;

  // KPI Summary
  text("KPI SUMMARY", 12, { bold: true }); y -= 18;

  const hyphen = "-";
  const kpiRows: [string, string][] = financeData
    ? [
        ["Total Income",   formatCurrencyPdf(financeData.totalIncome)],
        ["Total Expenses", formatCurrencyPdf(financeData.totalExpense)],
        ["Net Profit",     formatCurrencyPdf(financeData.netProfit)],
        ["Avg Order Value", metrics ? formatCurrencyPdf(metrics.aov) : hyphen],
        ["Growth Rate",    metrics ? `${metrics.growthRate.toFixed(1)}%` : hyphen],
        ["Top Category",   metrics?.topCategory ?? hyphen],
      ]
    : [
        ["Sales Revenue", salesKpi ? formatCurrencyPdf(salesKpi.current) : hyphen],
        ["Active Users",  usersKpi ? formatNumber(usersKpi.current) : hyphen],
        ["Churn Rate",    churnKpi ? `${churnKpi.current}%` : hyphen],
        ["Avg Order Value", metrics ? formatCurrencyPdf(metrics.aov) : hyphen],
        ["Growth Rate",   metrics ? `${metrics.growthRate.toFixed(1)}%` : hyphen],
        ["Top Category",  metrics?.topCategory ?? hyphen],
      ];

  for (const [label, value] of kpiRows) {
    text(label, 9, { bold: true }); text(value, 9, { x: col2 }); y -= 14;
  }

  y -= 10;
  line();

  // ── Chart: Bar Chart ──
  if (history.length > 0) {
    text("REVENUE TREND", 12, { bold: true }); y -= 18;

    const chartLeft = margin;
    const chartWidth = width - margin * 2;
    const chartHeight = 100;
    const chartBottom = y;
    const chartTop = y - chartHeight;

    // Axis
    page.drawLine({ start: { x: chartLeft, y: chartBottom }, end: { x: chartLeft + chartWidth, y: chartBottom }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });

    const maxVal = Math.max(...history.map(h => h.revenue));
    const barCount = history.length;
    const barGap = 4;
    const barWidth = Math.min((chartWidth - barGap * (barCount + 1)) / barCount, 20);
    const totalBarsWidth = barCount * barWidth + barGap * (barCount - 1);
    const chartStartX = chartLeft + (chartWidth - totalBarsWidth) / 2;

    for (let i = 0; i < history.length; i++) {
      const h = history[i];
      const barH = (h.revenue / maxVal) * chartHeight;
      const x = chartStartX + i * (barWidth + barGap);
      const yBar = chartBottom - barH;

      page.drawRectangle({ x, y: yBar, width: barWidth, height: barH, color: rgb(0.23, 0.51, 0.96) });
      // Label
      const label = h.month.length > 3 ? h.month.slice(0, 3) : h.month;
      page.drawText(label, { x: x - 1, y: chartBottom - chartHeight - 8, size: 6, font, color: rgb(0.4, 0.4, 0.4) });
    }

    y = chartBottom - chartHeight - 18;
  }

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
      page.drawText(formatCurrencyPdf(row.revenue), { x: tableLeft + colW, y, size: 8, font, color: rgb(0.3, 0.3, 0.3) });
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

export async function generateReportXlsx(userId: string, startDate?: string, endDate?: string): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const mod = (XLSX as any).default || XLSX;
  const dateFilter = { startDate, endDate };

  const [metrics, financeData, repo] = await Promise.all([
    computeMetrics(userId, startDate, endDate),
    getFinanceReportData(userId, startDate, endDate),
    getRepository(),
  ]);
  const [history, salesKpi, usersKpi, churnKpi] = financeData
    ? [financeData.history, null, null, null]
    : await Promise.all([
        repo.getSalesHistory(12, dateFilter),
        repo.getKpi("sales", dateFilter),
        repo.getKpi("users", dateFilter),
        repo.getKpi("churn_rate", dateFilter),
      ]);

  const wb = mod.utils.book_new();

  // Sheet 1: Summary
  const sheetTitle = financeData ? "Санхүүгийн тайлан" : "Borluulaltyn Tailan";
  const summaryData = financeData
    ? [
        [sheetTitle, ""],
        ["Үүсгэгдсэн:", new Date().toISOString().split("T")[0]],
        [],
        ["Үзүүлэлт", "Дүн (₮)"],
        ["Нийт орлого",  financeData.totalIncome],
        ["Нийт зарлага", financeData.totalExpense],
        ["Цэвэр ашиг",   financeData.netProfit],
        ["Дундаж гүйлгээ", metrics?.aov ?? "—"],
        ["Өсөлт (%)",     metrics?.growthRate ?? "—"],
        ["Тэргүүлэх зардал", metrics?.topCategory ?? "—"],
      ]
    : [
        [sheetTitle, ""],
        ["Uüsgegdsen:", new Date().toISOString().split("T")[0]],
        [],
        ["KPI", "Current", "Target"],
        ["Sales Revenue", salesKpi?.current ?? "—", salesKpi?.target ?? "—"],
        ["Active Users",  usersKpi?.current ?? "—", usersKpi?.target ?? "—"],
        ["Churn Rate (%)", churnKpi?.current ?? "—", churnKpi?.target ?? "—"],
        ["Avg Order Value", metrics?.aov ?? "—", ""],
        ["Growth Rate (%)", metrics?.growthRate ?? "—", ""],
        ["Top Category", metrics?.topCategory ?? "—", ""],
      ];
  const ws1 = mod.utils.aoa_to_sheet(summaryData);
  ws1["!cols"] = [{ wch: 25 }, { wch: 15 }, { wch: 15 }];
  mod.utils.book_append_sheet(wb, ws1, "Tailan");

  // Sheet 2: History
  if (history.length > 0) {
    const historyLabel = financeData ? "Орлого" : "Orlogo";
    const historyData = [
      ["Sar", historyLabel, "Oörchlolt (%)"],
      ...history.map((row, i) => {
        const prev = i > 0 ? history[i - 1].revenue : row.revenue;
        const change = prev > 0 ? ((row.revenue - prev) / prev * 100) : 0;
        return [row.month, row.revenue, i > 0 ? Number(change.toFixed(1)) : "—"];
      }),
    ];
    const ws2 = mod.utils.aoa_to_sheet(historyData);
    ws2["!cols"] = [{ wch: 20 }, { wch: 15 }, { wch: 15 }];
    mod.utils.book_append_sheet(wb, ws2, financeData ? "Сараар орлого" : "Borluulalt");
  }

  const buffer = mod.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buffer;
}
