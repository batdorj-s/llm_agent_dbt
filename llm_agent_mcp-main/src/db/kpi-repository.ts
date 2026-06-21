/**
 * kpi-repository.ts — Repository factory
 *
 * Auto-selects Supabase (production) or Mock (development/test) based on env vars.
 * All consumers import from here — never directly from supabase/mock files.
 *
 * Usage:
 *   import { getRepository } from "./db/kpi-repository.js";
 *   const repo = await getRepository();
 *   const kpi  = await repo.getKpi("sales");
 */

import dotenv from "dotenv";
dotenv.config();

import type { IKpiRepository } from "./types.js";
import { SQLiteKpiRepository } from "./sqlite-repository.js";

let _instance: IKpiRepository | null = null;

function isSupabaseConfigured(): boolean {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) return false;

  const databaseUrl = process.env.DATABASE_URL || "";
  const isLocal = databaseUrl.includes("127.0.0.1") || databaseUrl.includes("localhost");
  if (isLocal) return false;

  const placeholderPatterns = [
    /^your[_-]/i,
    /your-project\.supabase\.co/i,
    /example\.com/i,
    /placeholder/i,
  ];

  return !placeholderPatterns.some((p) => p.test(supabaseUrl) || p.test(supabaseKey));
}

export async function getRepository(): Promise<IKpiRepository> {
  if (_instance) return _instance; // Singleton — reuse connection

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (isSupabaseConfigured()) {
    try {
      // Dynamic import — only loads if Supabase credentials are present
      const { createClient } = await import("@supabase/supabase-js" as any);
      const { SupabaseKpiRepository } = await import("./supabase-repository.js");

      const client = createClient(supabaseUrl!, supabaseKey!);
      
      // Optional: Add a quick health check or validation here
      _instance = new SupabaseKpiRepository(client);
      console.log("[DB] Using Supabase repository [OK]");
    } catch (err) {
      console.warn("[DB] Supabase init failed, falling back to SQLite:", (err as Error).message);
      _instance = new SQLiteKpiRepository();
    }
  } else {
    console.log("[DB] Supabase not configured — using SQLite repository (Data Lake)");
    _instance = new SQLiteKpiRepository();
  }

  return _instance;
}

// Re-export types for convenience
export type { IKpiRepository, KpiMetric, SalesRecord } from "./types.js";
