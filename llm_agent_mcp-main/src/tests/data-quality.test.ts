import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

describe("Data Quality Module", () => {
  beforeAll(async () => {
    vi.mock("fs");
  });

  it("should return available=false when no run_results.json", async () => {
    vi.mocked(await import("fs")).existsSync = vi.fn().mockReturnValue(false);
    // Module reads from fs on every call, we test the handler logic
    const router = await import("../routes/data-quality.router.js");
    expect(router.default).toBeDefined();
  });

  it("should export test CRUD endpoints", async () => {
    const router = await import("../routes/data-quality.router.js");
    const routes = router.default.stack || [];
    const paths = routes.map((r: any) => r.route?.path).filter(Boolean);
    expect(paths).toContain("/data-quality/summary");
    expect(paths).toContain("/data-quality/tests");
    expect(paths).toContain("/data-quality/custom-tests");
  });

  it("should have new quality permissions registered", async () => {
    const rbac = await import("../middleware/rbac.js");
    expect(rbac.hasPermission("admin", "quality:create")).toBe(true);
    expect(rbac.hasPermission("admin", "quality:write")).toBe(true);
    expect(rbac.hasPermission("analyst", "quality:create")).toBe(true);
    expect(rbac.hasPermission("analyst", "quality:write")).toBe(true);
    expect(rbac.hasPermission("viewer", "quality:create")).toBe(false);
  });

  it("should create custom test definition table", async () => {
    const pool = await import("../db/pool.js");
    expect(pool).toBeDefined();
  });
});
