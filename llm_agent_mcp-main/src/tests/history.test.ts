import { describe, it, expect, vi, beforeAll } from "vitest";

describe("History Router", () => {
  let router: any;

  beforeAll(async () => {
    router = await import("../routes/history.router.js");
  });

  it("exports a default router function", () => {
    expect(router.default).toBeDefined();
    expect(typeof router.default).toBe("function");
  });

  it("has GET / route registered", () => {
    const routes = router.default.stack || [];
    const hasGet = routes.some((layer: any) =>
      layer.route?.methods?.get && layer.route.path === "/"
    );
    expect(hasGet).toBe(true);
  });

  it("has DELETE / route registered", () => {
    const routes = router.default.stack || [];
    const hasDelete = routes.some((layer: any) =>
      layer.route?.methods?.delete && layer.route.path === "/"
    );
    expect(hasDelete).toBe(true);
  });

  it("has GET /stats route registered", () => {
    const routes = router.default.stack || [];
    const hasStats = routes.some((layer: any) =>
      layer.route?.path === "/stats"
    );
    expect(hasStats).toBe(true);
  });
});
