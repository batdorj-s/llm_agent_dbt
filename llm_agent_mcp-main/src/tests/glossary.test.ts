import { describe, it, expect, vi, beforeAll } from "vitest";

describe("Glossary Data Dictionary", () => {
  let getPool: any;

  beforeAll(async () => {
    try {
      const mod = await import("../db/pool.js");
      getPool = mod.getPool;
    } catch {
      // tests run without DB
    }
  });

  it("should export router functions", async () => {
    const router = await import("../routes/glossary.router.js");
    expect(router.default).toBeDefined();
    expect(typeof router.default).toBe("function");
  });

  it("should have search endpoint handler", async () => {
    const router = await import("../routes/glossary.router.js");
    const routes = router.default.stack || [];
    const hasGetEndpoint = routes.some((layer: any) =>
      layer.route?.path?.includes("/glossary")
    );
    expect(hasGetEndpoint).toBe(true);
  });
});
