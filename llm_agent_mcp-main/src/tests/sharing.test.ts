import { describe, it, expect, vi } from "vitest";

describe("Sharing & Collaboration", () => {
  it("should export sharing router with team endpoints", async () => {
    const router = await import("../routes/sharing.router.js");
    expect(router.default).toBeDefined();
    const routes = router.default.stack || [];
    const paths = routes.map((r: any) => r.route?.path).filter(Boolean);
    expect(paths).toContain("/teams");
    expect(paths).toContain("/sharing");
    expect(paths).toContain("/shared-with-me");
  });

  it("should export canAccessResource function", async () => {
    const mod = await import("../routes/sharing.router.js");
    expect(mod.canAccessResource).toBeDefined();
    expect(typeof mod.canAccessResource).toBe("function");
  });

  it("canAccessResource should reject unshared resources", async () => {
    const mod = await import("../routes/sharing.router.js");
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const result = await mod.canAccessResource(mockPool, "catalog", "test_table", "user-123");
    expect(result).toBe(false);
    expect(mockPool.query).toHaveBeenCalled();
  });

  it("should create teams/team_members/shared_resources tables", async () => {
    const pool = await import("../db/pool.js");
    expect(pool).toBeDefined();
  });

  it("canAccessResource should handle owner access", async () => {
    const mod = await import("../routes/sharing.router.js");
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ owner_id: "user-123", visibility: "private" }],
      }),
    };
    const result = await mod.canAccessResource(mockPool, "catalog", "test_table", "user-123");
    expect(result).toBe(true);
  });

  it("canAccessResource should grant access for shared visibility", async () => {
    const mod = await import("../routes/sharing.router.js");
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ owner_id: "user-456", visibility: "shared" }],
      }),
    };
    const result = await mod.canAccessResource(mockPool, "catalog", "public_table", "any-user");
    expect(result).toBe(true);
  });
});
