import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parseExpiry, base64url, sign } from "../auth.js";

// ── Group 2: parseExpiry ─────────────────────────────────────

describe("parseExpiry", () => {
    const SEC = 1;
    const MIN = 60;
    const HOUR = 3600;
    const DAY = 86400;

    it('parses "1s" as 1 second', () => {
        expect(parseExpiry("1s")).toBe(1 * SEC);
    });

    it('parses "5m" as 300 seconds', () => {
        expect(parseExpiry("5m")).toBe(5 * MIN);
    });

    it('parses "2h" as 7200 seconds', () => {
        expect(parseExpiry("2h")).toBe(2 * HOUR);
    });

    it('parses "7d" as 604800 seconds', () => {
        expect(parseExpiry("7d")).toBe(7 * DAY);
    });

    it('parses "0s" as 0 (valid, token expires instantly)', () => {
        expect(parseExpiry("0s")).toBe(0);
    });

    it('returns default 3600 for empty string', () => {
        expect(parseExpiry("")).toBe(3600);
    });

    it('returns default 3600 for non-matching string ("abc")', () => {
        expect(parseExpiry("abc")).toBe(3600);
    });

    it('returns 3600 for unknown unit ("1x") — x not in multiplier map', () => {
        expect(parseExpiry("1x")).toBe(3600);
    });

    it('returns default 3600 for negative value ("-5m") — regex does not match', () => {
        expect(parseExpiry("-5m")).toBe(3600);
    });
});

// ── Group 3: base64url ───────────────────────────────────────

describe("base64url", () => {
    it('encodes "hello" without padding', () => {
        const result = base64url("hello");
        expect(result).not.toContain("=");
        expect(result).toBeTruthy();
    });

    it("encodes empty string as empty string", () => {
        expect(base64url("")).toBe("");
    });

    it("produces URL-safe output (no + or /)", () => {
        // Binary data that would contain + and / in regular base64
        const binary = "\xff\xfb\xf0\x0f\x01\x02\x03\x04\x05\x06\x07\x08";
        const result = base64url(binary);
        expect(result).not.toContain("+");
        expect(result).not.toContain("/");
        expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("padding is always stripped", () => {
        const result = base64url("test");
        expect(result).not.toContain("=");
    });
});

// ── Group 3: sign (HMAC) ─────────────────────────────────────

describe("sign — HMAC-SHA256", () => {
    it("is deterministic — same input + secret produces same output", () => {
        expect(sign("payload", "secret")).toBe(sign("payload", "secret"));
    });

    it("different secret produces different signature", () => {
        expect(sign("payload", "key1")).not.toBe(sign("payload", "key2"));
    });

    it("different payload produces different signature", () => {
        expect(sign("aaa", "secret")).not.toBe(sign("bbb", "secret"));
    });

    it("uses HMAC-SHA256 — source code static analysis", () => {
        const src = readFileSync("src/auth.ts", "utf8");
        expect(src).toContain('sha256');
    });
});
