import { describe, it, expect, vi } from "vitest";
import { createAdminAuthProvider, isAdminRole } from "../lib/admin/authProvider";

interface BridgeShape {
  getToken: () => string;
  getUser: () => { id: string; name: string; email: string; role: string } | null;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
  isLoggedIn: () => boolean;
  isLoading: () => boolean;
}

function makeBridge(overrides: Partial<BridgeShape> = {}): BridgeShape {
  const base = {
    getToken: () => "token-1",
    getUser: () => ({ id: "u1", name: "Admin", email: "a@b.c", role: "admin" }),
    login: vi.fn(async () => null),
    logout: vi.fn(),
    isLoggedIn: () => true,
    isLoading: () => false,
  };
  return { ...base, ...overrides };
}

describe("isAdminRole", () => {
  it("returns true only for admin role", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("analyst")).toBe(false);
    expect(isAdminRole("viewer")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe("createAdminAuthProvider", () => {
  describe("login", () => {
    it("returns error when bridge login fails", async () => {
      const bridge = makeBridge({ login: vi.fn(async () => "Invalid credentials") });
      const provider = createAdminAuthProvider(bridge);

      const result = await provider.login({ email: "a@b.c", password: "x" });

      expect(result.success).toBe(false);
      expect((result.error as { statusCode?: number } | undefined)?.statusCode).toBe(401);
    });

    it("logs out and rejects non-admin user", async () => {
      const bridge = makeBridge({
        getUser: () => ({ id: "u2", name: "Ana", email: "ana@b.c", role: "analyst" }),
      });
      const provider = createAdminAuthProvider(bridge);

      const result = await provider.login({ email: "ana@b.c", password: "x" });

      expect(bridge.logout).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect((result.error as { statusCode?: number } | undefined)?.statusCode).toBe(403);
    });

    it("succeeds and redirects to /admin for admin role", async () => {
      const bridge = makeBridge();
      const provider = createAdminAuthProvider(bridge);

      const result = await provider.login({ email: "a@b.c", password: "x" });

      expect(result.success).toBe(true);
      expect(result.redirectTo).toBe("/admin");
    });
  });

  describe("check", () => {
    it("redirects to login when unauthenticated", async () => {
      const provider = createAdminAuthProvider(makeBridge({ isLoggedIn: () => false }));

      const result = await provider.check();

      expect(result.authenticated).toBe(false);
      expect(result.redirectTo).toBe("/admin/login");
      expect(result.logout).toBe(true);
    });

    it("redirects to 403 for non-admin role", async () => {
      const provider = createAdminAuthProvider(
        makeBridge({
          getUser: () => ({ id: "u3", name: "V", email: "v@b.c", role: "viewer" }),
        })
      );

      const result = await provider.check();

      expect(result.authenticated).toBe(false);
      expect(result.redirectTo).toBe("/admin/403");
      expect(result.logout).toBe(false);
    });

    it("authenticates admin users", async () => {
      const provider = createAdminAuthProvider(makeBridge());

      const result = await provider.check();

      expect(result.authenticated).toBe(true);
    });
  });

  describe("identity & permissions", () => {
    it("returns identity from bridge user", async () => {
      const provider = createAdminAuthProvider(makeBridge());

      const identity = await provider.getIdentity?.();

      expect((identity as { id?: string } | null)?.id).toBe("u1");
      expect((identity as { role?: string } | null)?.role).toBe("admin");
    });

    it("returns permissions from role", async () => {
      const provider = createAdminAuthProvider(makeBridge());

      const perms = await provider.getPermissions?.();

      expect(perms).toEqual(["admin"]);
    });
  });
});
