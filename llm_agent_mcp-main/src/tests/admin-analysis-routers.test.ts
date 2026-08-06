import { describe, it, expect, beforeAll } from "vitest";

describe("Admin Analytics Router", () => {
  let router: any;

  beforeAll(async () => {
    router = await import("../routes/admin-analytics.router.js");
  });

  it("exports a default router", () => {
    expect(router.default).toBeDefined();
    expect(typeof router.default).toBe("function");
  });

  it("registers GET /analytics with admin:system permission", () => {
    const route = router.default.stack.find(
      (l: any) => l.route?.path === "/analytics" && l.route.methods.get
    );
    expect(route).toBeDefined();
    expect(route.route.stack.length).toBeGreaterThan(1);
  });
});

describe("Admin Analysis Router", () => {
  let router: any;

  beforeAll(async () => {
    router = await import("../routes/admin-analysis.router.js");
  });

  it("exports a default router", () => {
    expect(router.default).toBeDefined();
    expect(typeof router.default).toBe("function");
  });

  it("registers GET /analysis/tables with admin:system permission", () => {
    const route = router.default.stack.find(
      (l: any) => l.route?.path === "/analysis/tables" && l.route.methods.get
    );
    expect(route).toBeDefined();
    expect(route.route.stack.length).toBeGreaterThan(1);
  });

  it("registers POST /analysis/sql with admin:system permission", () => {
    const route = router.default.stack.find(
      (l: any) => l.route?.path === "/analysis/sql" && l.route.methods.post
    );
    expect(route).toBeDefined();
    expect(route.route.stack.length).toBeGreaterThan(1);
  });
});
