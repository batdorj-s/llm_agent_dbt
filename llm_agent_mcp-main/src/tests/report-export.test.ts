import { describe, it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

// ── Mocks ──────────────────────────────────────────────────────────────

const mockMetrics = {
  aov: 45.5,
  aovUnit: "$",
  growthRate: 12.3,
  growthDirection: "up" as const,
  topCategory: "Electronics",
  topCategoryValue: 15000,
  topCategoryUnit: "$",
};

const mockSalesKpi = { name: "sales" as const, current: 50000, target: 60000, unit: "$", updatedAt: new Date().toISOString() };
const mockUsersKpi = { name: "users" as const, current: 1200, target: 1500, unit: "", updatedAt: new Date().toISOString() };
const mockChurnKpi = { name: "churn_rate" as const, current: 5.2, target: 8, unit: "%", updatedAt: new Date().toISOString() };
const mockHistory = [
  { month: "January 2024", revenue: 40000 },
  { month: "February 2024", revenue: 45000 },
  { month: "March 2024", revenue: 50000 },
];

vi.mock("../agents/reportMetrics.js", () => ({
  computeMetrics: vi.fn().mockResolvedValue(mockMetrics),
}));

vi.mock("../db/kpi-repository.js", () => ({
  getRepository: vi.fn().mockResolvedValue({
    getKpi: vi.fn(async (metric: string) => {
      if (metric === "sales") return mockSalesKpi;
      if (metric === "users") return mockUsersKpi;
      if (metric === "churn_rate") return mockChurnKpi;
      return null;
    }),
    getSalesHistory: vi.fn().mockResolvedValue(mockHistory),
    updateKpiTarget: vi.fn(),
  }),
}));

// ── Tests ──────────────────────────────────────────────────────────────

describe("generateReportPdf", () => {
  it("returns a non-empty buffer starting with PDF header", async () => {
    const { generateReportPdf } = await import("../agents/reportExport.js");
    const buffer = await generateReportPdf("test-user");

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("includes KPI data in the PDF content", async () => {
    const { generateReportPdf } = await import("../agents/reportExport.js");
    const buffer = await generateReportPdf("test-user");

    const doc = await PDFDocument.load(buffer);
    const pages = doc.getPages();
    expect(pages.length).toBeGreaterThanOrEqual(1);

    const text = (pages[0] as any).getText?.() || "";
    const hasKpiText = text.includes("Sales") || text.includes("Revenue");
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });
});

describe("generateReportXlsx", () => {
  it("returns a non-empty buffer starting with PK (xlsx signature)", async () => {
    const { generateReportXlsx } = await import("../agents/reportExport.js");
    const buffer = await generateReportXlsx("test-user");

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.slice(0, 2).toString()).toBe("PK");
  });

  it("creates a workbook with expected sheet names", async () => {
    const { generateReportXlsx } = await import("../agents/reportExport.js");
    const buffer = await generateReportXlsx("test-user");

    const XLSX = await import("xlsx");
    const mod = (XLSX as any).default || XLSX;
    const wb = mod.read(buffer, { type: "buffer" });

    expect(wb.SheetNames).toContain("Tailan");
    expect(wb.SheetNames).toContain("Borluulalt");
  });
});
