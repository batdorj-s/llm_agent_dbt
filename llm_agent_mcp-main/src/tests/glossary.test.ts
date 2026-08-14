import { describe, it, expect, beforeAll } from "vitest";

describe("Glossary Data Dictionary", () => {

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
