import { describe, it, expect } from "vitest";

describe("auth token roundtrip", () => {
    it("createToken and verifyToken roundtrip works for admin", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("test-user", "admin");
        expect(token).toBeTruthy();
        expect(token.split(".").length).toBe(3);
        const result = auth.verifyToken(token);
        expect(result.success).toBe(true);
        expect(result.payload?.userId).toBe("test-user");
        expect(result.payload?.role).toBe("admin");
    });

    it("createToken and verifyToken roundtrip works for analyst", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("analyst-user", "analyst");
        const result = auth.verifyToken(token);
        expect(result.success).toBe(true);
        expect(result.payload?.role).toBe("analyst");
    });

    it("createToken and verifyToken roundtrip works for viewer", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("viewer-user", "viewer");
        const result = auth.verifyToken(token);
        expect(result.success).toBe(true);
        expect(result.payload?.role).toBe("viewer");
    });

    it("verifyToken fails on bad token", async () => {
        const auth = await import("../auth.js");
        const result = auth.verifyToken("invalid-token");
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
    });

    it("verifyToken fails on tampered token", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("test-user", "admin");
        const parts = token.split(".");
        const tamperedToken = `${parts[0]}.${parts[1]}.invalidsignature`;
        const result = auth.verifyToken(tamperedToken);
        expect(result.success).toBe(false);
    });

    it("verifyToken rejects unknown role", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("hacker" as any, "superadmin" as any);
        const result = auth.verifyToken(token);
        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid role");
    });

    it("verifyBearerHeader extracts token from Bearer header", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("test-user", "admin");
        const result = auth.verifyBearerHeader(`Bearer ${token}`);
        expect(result.success).toBe(true);
        expect(result.payload?.userId).toBe("test-user");
    });

    it("verifyBearerHeader fails on missing header", async () => {
        const auth = await import("../auth.js");
        const result = auth.verifyBearerHeader(undefined);
        expect(result.success).toBe(false);
    });

    it("requireJwtSecret does not throw", async () => {
        const auth = await import("../auth.js");
        expect(() => auth.requireJwtSecret()).not.toThrow();
    });
});

describe("RBAC — roleAtLeast hierarchy", () => {
    it("admin >= admin is true", async () => {
        const auth = await import("../auth.js");
        expect(auth.roleAtLeast("admin", "admin")).toBe(true);
    });

    it("admin >= analyst is true", async () => {
        const auth = await import("../auth.js");
        expect(auth.roleAtLeast("admin", "analyst")).toBe(true);
    });

    it("admin >= viewer is true", async () => {
        const auth = await import("../auth.js");
        expect(auth.roleAtLeast("admin", "viewer")).toBe(true);
    });

    it("analyst >= analyst is true", async () => {
        const auth = await import("../auth.js");
        expect(auth.roleAtLeast("analyst", "analyst")).toBe(true);
    });

    it("analyst >= admin is false", async () => {
        const auth = await import("../auth.js");
        expect(auth.roleAtLeast("analyst", "admin")).toBe(false);
    });

    it("viewer >= analyst is false", async () => {
        const auth = await import("../auth.js");
        expect(auth.roleAtLeast("viewer", "analyst")).toBe(false);
    });

    it("viewer >= viewer is true", async () => {
        const auth = await import("../auth.js");
        expect(auth.roleAtLeast("viewer", "viewer")).toBe(true);
    });
});

describe("RBAC — requireRole", () => {
    it("requireRole(admin) passes for admin token", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("u1", "admin");
        expect(() => auth.requireRole(token, "admin")).not.toThrow();
    });

    it("requireRole(admin) fails for analyst token", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("u1", "analyst");
        expect(() => auth.requireRole(token, "admin")).toThrow(/Forbidden/);
    });

    it("requireRole(analyst) passes for admin token", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("u1", "admin");
        expect(() => auth.requireRole(token, "analyst")).not.toThrow();
    });

    it("requireRole(analyst) passes for analyst token", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("u1", "analyst");
        expect(() => auth.requireRole(token, "analyst")).not.toThrow();
    });

    it("requireRole(analyst) fails for viewer token", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("u1", "viewer");
        expect(() => auth.requireRole(token, "analyst")).toThrow(/Forbidden/);
    });

    it("requireRole(viewer) passes for viewer token", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("u1", "viewer");
        expect(() => auth.requireRole(token, "viewer")).not.toThrow();
    });

    it("requireRole fails for invalid token", async () => {
        const auth = await import("../auth.js");
        expect(() => auth.requireRole("bad.token.here", "admin")).toThrow(/Unauthorized/);
    });
});
