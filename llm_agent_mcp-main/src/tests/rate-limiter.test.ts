import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../rate-limiter.js";

describe("RateLimiter", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("allows requests up to the limit", async () => {
        const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });
        expect(await limiter.check("k1")).toEqual({ allowed: true, remaining: 2, resetInMs: 60_000 });
        expect(await limiter.check("k1")).toEqual({ allowed: true, remaining: 1, resetInMs: 60_000 });
        expect(await limiter.check("k1")).toEqual({ allowed: true, remaining: 0, resetInMs: 60_000 });
    });

    it("blocks when limit is exceeded", async () => {
        const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });
        await limiter.check("k1");
        await limiter.check("k1");
        const result = await limiter.check("k1");
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
        expect(result.message).toContain("Rate limit exceeded");
    });

    it("resets after window elapses", async () => {
        const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });
        await limiter.check("k1");
        await limiter.check("k1");
        expect((await limiter.check("k1")).allowed).toBe(false);

        vi.advanceTimersByTime(60_001);

        expect((await limiter.check("k1")).allowed).toBe(true);
        expect((await limiter.check("k1")).remaining).toBe(0);
    });

    it("maintains separate windows per key", async () => {
        const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });
        expect((await limiter.check("a")).allowed).toBe(true);
        expect((await limiter.check("a")).allowed).toBe(true);
        expect((await limiter.check("a")).allowed).toBe(false);
        const b1 = await limiter.check("b");
        expect(b1.allowed).toBe(true);
        expect(b1.remaining).toBe(1);
    });

    it("reset clears state for a key", async () => {
        const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
        await limiter.check("k1");
        expect((await limiter.check("k1")).allowed).toBe(false);
        await limiter.reset("k1");
        expect((await limiter.check("k1")).allowed).toBe(true);
    });

    it("stats returns correct count and remaining", async () => {
        const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60_000 });
        expect(await limiter.stats("unknown")).toEqual({ requests: 0, remaining: 5 });
        await limiter.check("k1");
        await limiter.check("k1");
        expect(await limiter.stats("k1")).toEqual({ requests: 2, remaining: 3 });
    });

    it("sliding window evicts old entries", async () => {
        const limiter = new RateLimiter({ maxRequests: 3, windowMs: 10_000 });

        await limiter.check("k1"); // t=0
        vi.advanceTimersByTime(5_000);
        await limiter.check("k1"); // t=5s
        await limiter.check("k1"); // t=5s
        expect((await limiter.check("k1")).allowed).toBe(false); // 3 in window

        vi.advanceTimersByTime(5_001); // t=10_001ms — first entry (t=0) is evicted
        expect((await limiter.check("k1")).allowed).toBe(true);
    });

    it("startCleanup removes stale keys", async () => {
        const limiter = new RateLimiter({ maxRequests: 2, windowMs: 10_000 });
        const interval = limiter.startCleanup(1_000);

        await limiter.check("stale");
        vi.advanceTimersByTime(15_000);

        // After cleanup interval fires, "stale" should be removed
        vi.advanceTimersByTime(1_000);

        expect(await limiter.stats("stale")).toEqual({ requests: 0, remaining: 2 });
        clearInterval(interval);
    });

    it("startCleanup keeps active entries but prunes expired timestamps", async () => {
        const limiter = new RateLimiter({ maxRequests: 5, windowMs: 10_000 });
        const interval = limiter.startCleanup(1_000);

        await limiter.check("active"); // t=0
        vi.advanceTimersByTime(9_000);
        await limiter.check("active"); // t=9s — still in window
        vi.advanceTimersByTime(2_000); // t=11s — first entry expired
        vi.advanceTimersByTime(1_000); // cleanup fires

        const s = await limiter.stats("active");
        expect(s.requests).toBe(1); // only the t=9s entry remains
        expect(s.remaining).toBe(4);
        clearInterval(interval);
    });

    it("handles maxRequests = 0 (block all)", async () => {
        const limiter = new RateLimiter({ maxRequests: 0, windowMs: 60_000 });
        const result = await limiter.check("any");
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
    });

    it("handles large burst of requests", async () => {
        const limiter = new RateLimiter({ maxRequests: 1000, windowMs: 60_000 });
        for (let i = 0; i < 1000; i++) {
            expect((await limiter.check("burst")).allowed).toBe(true);
        }
        expect((await limiter.check("burst")).allowed).toBe(false);
        expect(await limiter.stats("burst")).toEqual({ requests: 1000, remaining: 0 });
    });

    it("send correct resetInMs for blocked request", async () => {
        const limiter = new RateLimiter({ maxRequests: 2, windowMs: 10_000 });
        await limiter.check("k1"); // t=0
        await limiter.check("k1"); // t=0
        vi.advanceTimersByTime(4_000);
        const result = await limiter.check("k1");
        expect(result.allowed).toBe(false);
        // oldest entry at t=0, windowMs=10_000, so resetInMs ≈ 6_000
        expect(result.resetInMs).toBeGreaterThanOrEqual(5_900);
        expect(result.resetInMs).toBeLessThanOrEqual(6_100);
    });
});
