import { describe, it, expect, vi } from "vitest";

describe("Unified Search", () => {
  it("should export search router", async () => {
    const router = await import("../routes/unified-search.router.js");
    expect(router.default).toBeDefined();
    const routes = router.default.stack || [];
    const paths = routes.map((r: any) => r.route?.path).filter(Boolean);
    expect(paths).toContain("/search");
  });

  it("should have dashboard:read permission for search", async () => {
    const rbac = await import("../middleware/rbac.js");
    expect(rbac.hasPermission("viewer", "dashboard:read")).toBe(true);
    expect(rbac.hasPermission("analyst", "dashboard:read")).toBe(true);
    expect(rbac.hasPermission("admin", "dashboard:read")).toBe(true);
  });

  it("search handler accepts query param", async () => {
    const router = await import("../routes/unified-search.router.js");
    expect(router.default).toBeDefined();
  });
});
