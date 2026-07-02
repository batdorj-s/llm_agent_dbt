import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

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

describe("hashPassword / verifyPassword — crypto path", () => {
    const PASSWORD = "MySecurePass123!";

    it("output format is salt:hash (hex:hex)", async () => {
        const auth = await import("../auth.js");
        const result = auth.hashPassword(PASSWORD);
        expect(result).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    });

    it("generates unique salt — two calls produce different hashes", async () => {
        const auth = await import("../auth.js");
        const hash1 = auth.hashPassword(PASSWORD);
        const hash2 = auth.hashPassword(PASSWORD);
        expect(hash1).not.toBe(hash2);
    });

    it("roundtrip — correct password returns true", async () => {
        const auth = await import("../auth.js");
        const stored = auth.hashPassword(PASSWORD);
        expect(auth.verifyPassword(PASSWORD, stored)).toBe(true);
    });

    it("wrong password returns false", async () => {
        const auth = await import("../auth.js");
        const stored = auth.hashPassword(PASSWORD);
        expect(auth.verifyPassword("WrongPassword!", stored)).toBe(false);
    });

    it("empty password produces valid hash and verifies", async () => {
        const auth = await import("../auth.js");
        const stored = auth.hashPassword("");
        expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
        expect(auth.verifyPassword("", stored)).toBe(true);
    });

    it("very long password (1KB) produces valid hash and verifies", async () => {
        const auth = await import("../auth.js");
        const longPw = "a".repeat(1024);
        const stored = auth.hashPassword(longPw);
        expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
        expect(auth.verifyPassword(longPw, stored)).toBe(true);
    });

    it("corrupted hash format (no colon) returns false — no throw", async () => {
        const auth = await import("../auth.js");
        expect(auth.verifyPassword(PASSWORD, "justahexstring")).toBe(false);
    });

    it("corrupted hash format (extra colon) returns false — no throw", async () => {
        const auth = await import("../auth.js");
        expect(auth.verifyPassword(PASSWORD, "aa:bb:cc")).toBe(false);
    });

    it("empty stored hash returns false — no throw", async () => {
        const auth = await import("../auth.js");
        expect(auth.verifyPassword(PASSWORD, "")).toBe(false);
    });

    it("uses timingSafeEqual — source code static analysis", async () => {
        const src = readFileSync("src/auth.ts", "utf8");
        expect(src).toContain("timingSafeEqual");
        expect(src).not.toMatch(/derivedHex\s*===\s*hash/);
    });
});
