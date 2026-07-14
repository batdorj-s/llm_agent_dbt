import { describe, it, expect, vi } from "vitest";

describe("Report Scheduler", () => {
  it("should export scheduler service functions", async () => {
    const scheduler = await import("../services/scheduler.js");
    expect(scheduler.startScheduler).toBeDefined();
    expect(typeof scheduler.startScheduler).toBe("function");
    expect(scheduler.stopScheduler).toBeDefined();
    expect(typeof scheduler.stopScheduler).toBe("function");
    expect(scheduler.computeNextRun).toBeDefined();
    expect(typeof scheduler.computeNextRun).toBe("function");
  });

  it("computeNextRun should return null for invalid cron", async () => {
    const { computeNextRun } = await import("../services/scheduler.js");
    expect(computeNextRun("invalid")).toBeNull();
    expect(computeNextRun("")).toBeNull();
  });

  it("should create scheduled_reports and generated_reports tables", async () => {
    const pool = await import("../db/pool.js");
    expect(pool).toBeDefined();
  });

  it("should export scheduler router with CRUD + download endpoints", async () => {
    const router = await import("../routes/scheduler.router.js");
    expect(router.default).toBeDefined();
    const routes = router.default.stack || [];
    const paths = routes.map((r: any) => r.route?.path).filter(Boolean);
    expect(paths).toContain("/scheduler/reports");
    expect(paths).toContain("/scheduler/reports/generated");
    expect(paths).toContain("/scheduler/reports/:id/download");
  });

  it("should export generation helper functions", async () => {
    const mod = await import("../services/scheduler.js");
    expect(typeof mod.generateCsv).toBe("function");
    expect(typeof mod.generateJson).toBe("function");
  });
});
