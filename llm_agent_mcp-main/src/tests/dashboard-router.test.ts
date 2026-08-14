import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "u1";
    req.user = { userId: "u1", role: "analyst" };
    next();
  },
}));

vi.mock("../middleware/rbac.js", () => ({
  requirePermission: (_perm: string) => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../rate-limiter.js", () => ({
  exportLimiter: { check: vi.fn() },
}));

vi.mock("../agents/reportMetrics.js", () => ({
  computeMetrics: vi.fn(),
}));

vi.mock("../agents/reportExport.js", () => ({
  generateReportPdf: vi.fn(async () => Buffer.from("%PDF-fake")),
  generateReportXlsx: vi.fn(async () => Buffer.from("xlsx-fake")),
}));

import { computeMetrics } from "../agents/reportMetrics.js";
import { exportLimiter } from "../rate-limiter.js";

const mockedMetrics = computeMetrics as ReturnType<typeof vi.fn>;
const mockedLimiter = exportLimiter as unknown as { check: ReturnType<typeof vi.fn> };

function findHandler(routerModule: any, method: string, path: string) {
  const layer = routerModule.default.stack.find(
    (l: any) => l.route?.path === path && l.route.methods[method]
  );
  expect(layer).toBeDefined();
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  const res: any = { _status: 200, _json: null, _body: null, _headers: {} };
  res.status = (s: number) => {
    res._status = s;
    return res;
  };
  res.json = (j: unknown) => {
    res._json = j;
    return res;
  };
  res.setHeader = (k: string, v: string) => {
    res._headers[k] = v;
    return res;
  };
  res.send = (b: unknown) => {
    res._body = b;
    return res;
  };
  return res;
}

describe("dashboard.router", () => {
  let dashboardRouter: any;
  let computedMetricsHandler: any;
  let exportPdfHandler: any;
  let exportXlsxHandler: any;

  beforeAll(async () => {
    dashboardRouter = await import("../routes/dashboard.router.js");
    computedMetricsHandler = findHandler(dashboardRouter, "get", "/computed-metrics");
    exportPdfHandler = findHandler(dashboardRouter, "post", "/export-pdf");
    exportXlsxHandler = findHandler(dashboardRouter, "post", "/export-xlsx");
  });

  beforeEach(() => {
    mockedMetrics.mockReset();
    mockedLimiter.check.mockReset();
    mockedLimiter.check.mockResolvedValue({ allowed: true, remaining: 4, message: "" });
  });

  describe("GET /computed-metrics", () => {
    it("returns computed metrics for the user", async () => {
      mockedMetrics.mockResolvedValueOnce({ totalRevenue: 100 });
      const res = mockRes();
      await computedMetricsHandler({ userId: "u1", user: { userId: "u1" }, query: {} }, res);
      expect(res._status).toBe(200);
      expect(res._json).toEqual({ totalRevenue: 100 });
    });

    it("returns 404 when no active dataset", async () => {
      mockedMetrics.mockResolvedValueOnce(null);
      const res = mockRes();
      await computedMetricsHandler({ userId: "u1", user: { userId: "u1" }, query: {} }, res);
      expect(res._status).toBe(404);
      expect(res._json.error).toMatch(/No active dataset/i);
    });

    it("returns 500 on compute failure", async () => {
      mockedMetrics.mockRejectedValueOnce(new Error("boom"));
      const res = mockRes();
      await computedMetricsHandler({ userId: "u1", user: { userId: "u1" }, query: {} }, res);
      expect(res._status).toBe(500);
    });
  });

  describe("POST /export-pdf", () => {
    it("returns a PDF attachment with rate-limit headers", async () => {
      const res = mockRes();
      await exportPdfHandler({ userId: "u1", user: { userId: "u1" }, query: {}, ip: "1.1.1.1" }, res);
      expect(res._status).toBe(200);
      expect(res._headers["Content-Type"]).toBe("application/pdf");
      expect(res._headers["Content-Disposition"]).toContain("report-");
      expect(res._headers["X-RateLimit-Remaining"]).toBe("4");
      expect(res._body).toEqual(Buffer.from("%PDF-fake"));
    });

    it("returns 429 when the export limiter rejects", async () => {
      mockedLimiter.check.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        message: "Export limit reached",
      });
      const res = mockRes();
      await exportPdfHandler({ userId: "u1", user: { userId: "u1" }, query: {} }, res);
      expect(res._status).toBe(429);
      expect(res._json.error).toMatch(/limit/i);
    });
  });

  describe("POST /export-xlsx", () => {
    it("returns an XLSX attachment for the user", async () => {
      const res = mockRes();
      await exportXlsxHandler({ userId: "u1", user: { userId: "u1" }, query: {} }, res);
      expect(res._status).toBe(200);
      expect(res._headers["Content-Type"]).toContain("spreadsheetml");
      expect(res._body).toEqual(Buffer.from("xlsx-fake"));
    });

    it("returns 429 when limited", async () => {
      mockedLimiter.check.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        message: "Export limit reached",
      });
      const res = mockRes();
      await exportXlsxHandler({ userId: "u1", user: { userId: "u1" }, query: {} }, res);
      expect(res._status).toBe(429);
    });
  });
});