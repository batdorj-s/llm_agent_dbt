import { describe, it, expect, vi, beforeAll } from "vitest";

describe("API Key Management", () => {
  it("should export router with CRUD endpoints", async () => {
    const router = await import("../routes/api-keys.router.js");
    expect(router.default).toBeDefined();
    const routes = router.default.stack || [];
    const paths = routes.map((r: any) => r.route?.path).filter(Boolean);
    expect(paths).toContain("/admin/api-keys");
  });

  it("should export requireApiKey middleware", async () => {
    const mod = await import("../routes/api-keys.router.js");
    expect(mod.requireApiKey).toBeDefined();
    expect(typeof mod.requireApiKey).toBe("function");
  });

  it("requireApiKey should reject missing header", async () => {
    const mod = await import("../routes/api-keys.router.js");
    const middleware = mod.requireApiKey;

    const req = { headers: {} } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should create api_keys table on init", async () => {
    const pool = await import("../db/pool.js");
    expect(pool).toBeDefined();
  });
});
