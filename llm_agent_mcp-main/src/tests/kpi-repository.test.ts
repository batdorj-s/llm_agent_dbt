import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the factory logic in isolation via isSupabaseConfigured logic,
// not the full import (which needs PostgreSQL and Supabase connections)

describe("KPI Repository Factory — isSupabaseConfigured logic", () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
        vi.resetModules();
        // Clear singleton by removing module from cache
        delete process.env.SUPABASE_URL;
        delete process.env.SUPABASE_ANON_KEY;
        delete process.env.DATABASE_URL;
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it("returns false when both SUPABASE_URL and SUPABASE_ANON_KEY are missing", async () => {
        const mod = await import("../db/kpi-repository.js");
        const repo = await mod.getRepository();
        // Should be SQLiteKpiRepository — check by calling getKpi safely
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
        // SQLiteKpiRepository should fall back gracefully (no Data Lake = null result)
        const result = await repo.getKpi("sales");
        expect(result).toBeNull();
    });
});
