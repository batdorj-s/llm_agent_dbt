import { Router } from "express";
import { getUserId, extractDateFilter } from "./shared.js";
import { computeMetrics } from "../agents/reportMetrics.js";
import { generateReportPdf, generateReportXlsx } from "../agents/reportExport.js";

const router = Router();

router.get("/computed-metrics", async (req, res) => {
  const { startDate, endDate } = extractDateFilter(req);

  try {
    const metrics = await computeMetrics(getUserId(req), startDate, endDate);
    if (!metrics) return res.status(404).json({ error: "No active dataset found" });
    res.json(metrics);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/export-pdf", async (req, res) => {
  const { startDate, endDate } = extractDateFilter(req);

  try {
    const pdfBuffer = await generateReportPdf(getUserId(req), startDate, endDate);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report-${new Date().toISOString().split("T")[0]}.pdf"`);
    res.send(pdfBuffer);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/export-xlsx", async (req, res) => {
  const { startDate, endDate } = extractDateFilter(req);

  try {
    const xlsxBuffer = await generateReportXlsx(getUserId(req), startDate, endDate);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="report-${new Date().toISOString().split("T")[0]}.xlsx"`);
    res.send(xlsxBuffer);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
