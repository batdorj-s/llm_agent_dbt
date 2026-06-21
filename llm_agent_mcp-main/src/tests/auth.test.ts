import { describe, it, expect } from "vitest";

describe("auth token roundtrip", () => {
    it("createToken and verifyToken roundtrip works", async () => {
        const auth = await import("../auth.js");
        const token = auth.createToken("test-user", "admin");
        expect(token).toBeTruthy();
        expect(token.split(".").length).toBe(3);
        const result = auth.verifyToken(token);
        expect(result.success).toBe(true);
        expect(result.payload?.userId).toBe("test-user");
        expect(result.payload?.role).toBe("admin");
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

    it("createToken accepts object signature for backward compat", async () => {
        const auth = await import("../auth.js");
        // createToken(userId: string, role: UserRole)
        const token = auth.createToken("admin-user", "admin");
        const result = auth.verifyToken(token);
        expect(result.success).toBe(true);
        expect(result.payload?.userId).toBe("admin-user");
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
