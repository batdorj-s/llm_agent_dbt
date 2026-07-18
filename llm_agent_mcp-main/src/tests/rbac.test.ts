import { describe, it, expect, vi } from "vitest";

describe("RBAC Middleware", () => {
  let hasPermission: any, requirePermission: any, requireRole: any, getPermissions: any;

  beforeAll(async () => {
    const mod = await import("../middleware/rbac.js");
    hasPermission = mod.hasPermission;
    requirePermission = mod.requirePermission;
    requireRole = mod.requireRole;
    getPermissions = mod.getPermissions;
  });

  describe("hasPermission", () => {
    it("returns true for viewer permission on viewer role", () => {
      expect(hasPermission("viewer", "dashboard:read")).toBe(true);
    });

    it("returns false for admin-only permission on viewer role", () => {
      expect(hasPermission("viewer", "admin:users")).toBe(false);
    });

    it("returns true for analyst permission on analyst role", () => {
      expect(hasPermission("analyst", "kpi:anomaly")).toBe(true);
    });

    it("returns true for viewer permissions on admin role", () => {
      expect(hasPermission("admin", "dashboard:read")).toBe(true);
    });

    it("returns false for unknown permission", () => {
      expect(hasPermission("viewer", "nonexistent:perm")).toBe(false);
    });

    it("returns false for unknown role", () => {
      expect(hasPermission("unknown" as any, "dashboard:read")).toBe(false);
    });
  });

  describe("getPermissions", () => {
    it("returns all permissions for admin", () => {
      const perms = getPermissions("admin");
      expect(perms).toContain("admin:users");
      expect(perms).toContain("dashboard:read");
      expect(perms).toContain("kpi:anomaly");
    });

    it("does not include admin permissions for viewer", () => {
      const perms = getPermissions("viewer");
      expect(perms).not.toContain("admin:users");
    });

    it("returns empty array for unknown role", () => {
      expect(getPermissions("unknown" as any)).toEqual([]);
    });
  });

  describe("requirePermission middleware", () => {
    const mockResponse = () => {
      const res: any = { statusCode: 0, body: null };
      res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
      res.json = vi.fn((body: any) => { res.body = body; return res; });
      return res;
    };

    it("returns 401 if no user on request", () => {
      const req = { user: null } as any;
      const res = mockResponse();
      const next = vi.fn();

      requirePermission("dashboard:read")(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 if role lacks permission", () => {
      const req = { user: { role: "viewer" } } as any;
      const res = mockResponse();
      const next = vi.fn();

      requirePermission("admin:users")(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe("Insufficient permissions");
      expect(next).not.toHaveBeenCalled();
    });

    it("calls next if user has permission", () => {
      const req = { user: { role: "admin" } } as any;
      const res = mockResponse();
      const next = vi.fn();

      requirePermission("admin:users")(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("requireRole middleware", () => {
    const mockResponse = () => {
      const res: any = { statusCode: 0, body: null };
      res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
      res.json = vi.fn((body: any) => { res.body = body; return res; });
      return res;
    };

    it("returns 401 if no user on request", () => {
      const req = { user: null } as any;
      const res = mockResponse();
      const next = vi.fn();

      requireRole("viewer")(req, res, next);

      expect(res.statusCode).toBe(401);
    });

    it("returns 403 if user role is below minimum", () => {
      const req = { user: { role: "viewer" } } as any;
      const res = mockResponse();
      const next = vi.fn();

      requireRole("analyst")(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe("Insufficient role level");
    });

    it("calls next if user role meets minimum", () => {
      const req = { user: { role: "admin" } } as any;
      const res = mockResponse();
      const next = vi.fn();

      requireRole("analyst")(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("allows viewer for viewer minimum", () => {
      const req = { user: { role: "viewer" } } as any;
      const res = mockResponse();
      const next = vi.fn();

      requireRole("viewer")(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
