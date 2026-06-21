import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Must be top-level (hoisted by Vitest) — prevents .env file from interfering
vi.mock("dotenv", () => ({
    default: { config: vi.fn() },
    config: vi.fn(),
}));

// Must be top-level — intercepts dynamic import inside getRepository()
vi.mock("@supabase/supabase-js", () => ({
    createClient: vi.fn(() => ({
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
                })),
                order: vi.fn(() => ({
                    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
            })),
        })),
    })),
}));

describe("KPI Repository Factory — isSupabaseConfigured logic", () => {
    const KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "DATABASE_URL"] as const;
    const SAVED: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const key of KEYS) {
            SAVED[key] = process.env[key];
            delete process.env[key];
        }
        vi.resetModules();
    });

    afterEach(() => {
        for (const key of KEYS) {
            if (SAVED[key] !== undefined) {
                process.env[key] = SAVED[key];
            } else {
                delete process.env[key];
            }
        }
    });

    it("returns false when both SUPABASE_URL and SUPABASE_ANON_KEY are missing", async () => {
        const mod = await import("../db/kpi-repository.js");
        const repo = await mod.getRepository();
        expect(repo.constructor.name).toBe("SQLiteKpiRepository");
    });

    it("returns false with placeholder Supabase URL", async () => {
        process.env.SUPABASE_URL = "https://your-project.supabase.co";
        process.env.SUPABASE_ANON_KEY = "placeholder-key";
        const mod = await import("../db/kpi-repository.js");
        const repo = await mod.getRepository();
        expect(repo.constructor.name).toBe("SQLiteKpiRepository");
    });

    it("returns false when keyword 'your_' is in Supabase key", async () => {
        process.env.SUPABASE_URL = "https://real-project.supabase.co";
        process.env.SUPABASE_ANON_KEY = "your_anon_key_here";
        const mod = await import("../db/kpi-repository.js");
        const repo = await mod.getRepository();
        expect(repo.constructor.name).toBe("SQLiteKpiRepository");
    });

    it("returns false when DATABASE_URL points to localhost (dev mode)", async () => {
        process.env.SUPABASE_URL = "https://real-project.supabase.co";
        process.env.SUPABASE_ANON_KEY = "real-anon-key-12345";
        process.env.DATABASE_URL = "postgres://localhost:5432/postgres";
        const mod = await import("../db/kpi-repository.js");
        const repo = await mod.getRepository();
        expect(repo.constructor.name).toBe("SQLiteKpiRepository");
    });

    it("returns SQLite even without env — getKpi does not crash", async () => {
        const mod = await import("../db/kpi-repository.js");
        const repo = await mod.getRepository();
        const result = await repo.getKpi("sales");
        expect(result).toBeNull();
    });

    describe("Positive path — Supabase configured", () => {
        beforeEach(() => {
            process.env.SUPABASE_URL = "https://real-project.supabase.co";
            process.env.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid-jwt-token";
            vi.resetModules();
        });

        it("returns SupabaseKpiRepository when valid credentials and mock @supabase/supabase-js", async () => {
            const mod = await import("../db/kpi-repository.js");
            const repo = await mod.getRepository();

            expect(repo.constructor.name).toBe("SupabaseKpiRepository");
        });

        it("calling getKpi on mock Supabase repo does not crash", async () => {
            await import("@supabase/supabase-js");
            const mod = await import("../db/kpi-repository.js");
            const repo = await mod.getRepository();

            await expect(repo.getKpi("sales")).resolves.toBeNull();
        });

        it("getSalesHistory returns empty array on mock Supabase client", async () => {
            await import("@supabase/supabase-js");
            const mod = await import("../db/kpi-repository.js");
            const repo = await mod.getRepository();

            const history = await repo.getSalesHistory(5);
            expect(history).toEqual([]);
        });
    });
});
