/**
 * pool.ts — PostgreSQL pool management, schema initialization, and core utilities.
 */

import { Pool } from "pg";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";
import { hashPassword } from "../auth.js";

dotenv.config();

// ── Types ─────────────────────────────────────────────────────

export type DataLakeCatalogEntry = {
  id: number;
  table_name: string;
  created_by: string | null;
  owner_id: string | null;
  visibility: "private" | "shared";
  created_at: string;
  columns_info: string;
  description: string | null;
  column_profiles?: Record<string, any>;
};

// ── Pool state ────────────────────────────────────────────────

let pool: Pool | null = null;
let _pgAvailable = false;
let _initPromise: Promise<void> | null = null;

export function getPool(): Pool {
  if (!pool) throw new Error("Data Lake not initialized.");
  return pool;
}

export function isPgAvailable(): boolean {
  return _pgAvailable;
}

// ── SQL helpers ───────────────────────────────────────────────

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function buildSslConfig(databaseUrl: string): false | { rejectUnauthorized: true; ca?: string } {
  const isLocal = databaseUrl.includes("127.0.0.1") || databaseUrl.includes("localhost") || databaseUrl.includes("host.docker.internal");
  if (isLocal) return false;
  return {
    rejectUnauthorized: true,
    ...(process.env.PGSSLROOTCERT && { ca: fs.readFileSync(process.env.PGSSLROOTCERT, "utf8") }),
  };
}

// ── Schema initialization ─────────────────────────────────────

export async function initDataLake(): Promise<void> {
  if (pool) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    if (pool) return;

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.warn("[Data Lake] DATABASE_URL not configured.");
      return;
    }

    console.log("[Data Lake] Connecting to PostgreSQL...");
    pool = new Pool({ connectionString: databaseUrl, ssl: buildSslConfig(databaseUrl) });

    try {
      await pool.query("SELECT 1");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[Data Lake] PostgreSQL unavailable: ${errMsg}`);
      await pool.end().catch(() => {});
      pool = null;
      _pgAvailable = false;
      _initPromise = null;
      return;
    }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS data_lake_catalog (
          id SERIAL PRIMARY KEY,
          table_name TEXT UNIQUE NOT NULL,
          created_by TEXT,
          owner_id TEXT,
          visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          columns_info TEXT,
          description TEXT,
          column_profiles JSONB DEFAULT '{}'
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS uploaded_files (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          type TEXT NOT NULL,
          description TEXT,
          owner_id TEXT,
          visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'viewer',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      try {
        await pool.query(`ALTER TABLE data_lake_catalog ADD COLUMN IF NOT EXISTS owner_id TEXT`);
        await pool.query(`ALTER TABLE data_lake_catalog ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`);
        await pool.query(`ALTER TABLE data_lake_catalog ADD COLUMN IF NOT EXISTS column_profiles JSONB DEFAULT '{}'`);
        await pool.query(`ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS semantic_groups JSONB DEFAULT NULL`);
        await pool.query(`ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NULL`);
        await pool.query(`ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS owner_id TEXT`);
        await pool.query(`ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`);

        await pool.query(`
          UPDATE data_lake_catalog
          SET owner_id = created_by, visibility = 'private'
          WHERE owner_id IS NULL AND created_by IS NOT NULL AND created_by NOT IN ('system', 'admin')
        `);
        await pool.query(`
          UPDATE data_lake_catalog
          SET visibility = 'shared'
          WHERE owner_id IS NULL AND (created_by IS NULL OR created_by IN ('system', 'admin'))
        `);
        await pool.query(`
          UPDATE uploaded_files SET visibility = 'shared' WHERE owner_id IS NULL
        `);
      } catch (alterErr) {
        console.warn("[Data Lake] ALTER TABLE or legacy migration note:", (alterErr as Error).message);
      }

      try {
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_data_lake_catalog_created_at ON data_lake_catalog (created_at DESC)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_uploaded_files_created_at ON uploaded_files (created_at DESC)`);
      } catch (indexErr) {
        console.warn("[Data Lake] Index creation error (non-fatal):", (indexErr as Error).message);
      }

      await pool.query(`
        CREATE TABLE IF NOT EXISTS table_relationships (
          id SERIAL PRIMARY KEY,
          source_table TEXT NOT NULL,
          source_column TEXT NOT NULL,
          target_table TEXT NOT NULL,
          target_column TEXT NOT NULL,
          confidence REAL DEFAULT 0.5,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(source_table, source_column, target_table, target_column)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_table_relationships_source ON table_relationships (source_table)`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS scheduled_reports (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          query TEXT NOT NULL,
          format TEXT NOT NULL DEFAULT 'pdf',
          cron_expression TEXT NOT NULL,
          recipients TEXT[] DEFAULT '{}',
          created_by TEXT,
          is_active BOOLEAN DEFAULT true,
          last_run_at TIMESTAMPTZ,
          next_run_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_reports_next_run ON scheduled_reports (next_run_at)`);
      try { await pool.query(`ALTER TABLE scheduled_reports ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`); } catch {}

      await pool.query(`
        CREATE TABLE IF NOT EXISTS teams (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          created_by TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS team_members (
          team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
          joined_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (team_id, user_id)
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS shared_resources (
          id SERIAL PRIMARY KEY,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          granted_to_user_id TEXT,
          granted_to_team_id TEXT,
          permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit', 'admin')),
          granted_by TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(resource_type, resource_id, granted_to_user_id, granted_to_team_id)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_shared_resources_resource ON shared_resources (resource_type, resource_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_shared_resources_user ON shared_resources (granted_to_user_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_shared_resources_team ON shared_resources (granted_to_team_id)`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          key_hash TEXT NOT NULL,
          key_prefix TEXT NOT NULL,
          name TEXT NOT NULL,
          permissions TEXT[] DEFAULT '{}',
          expires_at TIMESTAMPTZ,
          is_active BOOLEAN DEFAULT true,
          last_used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys (key_hash)`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS rate_limiter (
          key TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      try {
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_rate_limiter_key_expires ON rate_limiter (key, expires_at)`);
      } catch {}
      try {
        await pool.query(`ALTER TABLE rate_limiter ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
      } catch {}

      await pool.query(`
        CREATE TABLE IF NOT EXISTS rag_documents (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          category TEXT NOT NULL,
          department TEXT DEFAULT 'general',
          author TEXT,
          created_at TEXT,
          source_name TEXT,
          parent_doc_id TEXT,
          chunk_index INTEGER,
          shared BOOLEAN DEFAULT true,
          keywords TEXT[] DEFAULT '{}',
          uploaded_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS kpi_targets (
          metric_name TEXT PRIMARY KEY,
          target_value REAL NOT NULL,
          unit TEXT NOT NULL
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS sql_gen_log (
          id SERIAL PRIMARY KEY,
          user_id TEXT,
          request_id TEXT,
          ip_address TEXT,
          query TEXT,
          outcome TEXT NOT NULL,
          attempts INTEGER DEFAULT 1,
          table_name TEXT,
          error TEXT,
          duration_ms INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(`ALTER TABLE sql_gen_log ADD COLUMN IF NOT EXISTS request_id TEXT`);
      await pool.query(`ALTER TABLE sql_gen_log ADD COLUMN IF NOT EXISTS ip_address TEXT`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_sql_gen_log_created_at ON sql_gen_log (created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_sql_gen_log_outcome ON sql_gen_log (outcome)`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS generated_reports (
          id TEXT PRIMARY KEY,
          schedule_id TEXT REFERENCES scheduled_reports(id) ON DELETE SET NULL,
          format TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_size BIGINT DEFAULT 0,
          row_count INTEGER DEFAULT 0,
          query TEXT,
          generated_by TEXT,
          generated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_generated_reports_schedule ON generated_reports (schedule_id)`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS data_quality_tests (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          model_name TEXT NOT NULL,
          column_name TEXT,
          test_type TEXT NOT NULL DEFAULT 'assert_true',
          expression TEXT,
          severity TEXT DEFAULT 'error' CHECK (severity IN ('error', 'warn')),
          description TEXT DEFAULT '',
          created_by TEXT,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_data_quality_tests_model ON data_quality_tests (model_name)`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS notification_preferences (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          channel TEXT NOT NULL CHECK (channel IN ('email', 'slack', 'telegram')),
          enabled BOOLEAN DEFAULT true,
          config JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_notification_prefs_user ON notification_preferences (user_id, channel)`);

      const existing = await pool.query("SELECT metric_name, target_value, unit FROM kpi_targets");
      if (existing.rows.length > 0) {
        for (const row of existing.rows as Array<{ metric_name: string; target_value: number; unit: string }>) {
          if (row.metric_name === "sales" && row.unit === "USD") {
            await pool.query("UPDATE kpi_targets SET target_value = $1, unit = $2 WHERE metric_name = $3", [0, "₮", "sales"]);
          }
        }
      }

      // Seed default admin user if no users exist
      const existingUsers = await pool.query("SELECT id FROM users LIMIT 1");
      if (existingUsers.rows.length === 0) {
        const adminEmail = process.env.ADMIN_EMAIL || "admin@enterprise.ai";
        const adminId = "user-admin-001";
        const randomPwd = crypto.randomBytes(24).toString("hex");
        const adminPassword = process.env.ADMIN_PASSWORD || randomPwd;
        const hashedPwd = hashPassword(adminPassword);
        await pool.query(
          `INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5)`,
          [adminId, adminEmail, "Admin", hashedPwd, "admin"]
        );
        if (process.env.ADMIN_PASSWORD) {
          console.log(`[Data Lake] Admin user created: ${adminEmail} (password from ADMIN_PASSWORD)`);
        } else {
          console.log(`\n═══════════════════════════════════════════`);
          console.log(`  Admin credentials`);
          console.log(`  Email:    ${adminEmail}`);
          console.log(`  Password: ${adminPassword}`);
          console.log(`  (Set ADMIN_PASSWORD in .env to silence)`);
          console.log(`═══════════════════════════════════════════\n`);
        }
      }

      const resetOnBoot = process.env.RESET_ADMIN_ON_BOOT === "true";
      if (resetOnBoot && (process.env.ADMIN_PASSWORD || process.env.ADMIN_EMAIL)) {
        const adminId = "user-admin-001";
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;
        if (process.env.ADMIN_PASSWORD) {
          sets.push(`password_hash = $${idx++}`);
          params.push(hashPassword(process.env.ADMIN_PASSWORD));
        }
        if (process.env.ADMIN_EMAIL) {
          sets.push(`email = $${idx++}`);
          params.push(process.env.ADMIN_EMAIL);
        }
        params.push(adminId);
        await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`, params);
        console.log(`[Data Lake] Admin credentials updated from env vars (RESET_ADMIN_ON_BOOT=true)`);
      } else if (!resetOnBoot && (process.env.ADMIN_PASSWORD || process.env.ADMIN_EMAIL)) {
        console.warn("[Data Lake] ADMIN_PASSWORD/ADMIN_EMAIL env vars set but RESET_ADMIN_ON_BOOT is not 'true' — skipping credential reset for security. Set RESET_ADMIN_ON_BOOT=true to apply.");
      }

      _pgAvailable = true;
      console.log("[Data Lake] Connected to PostgreSQL");

      const existingTables = await pool.query(`SELECT table_name FROM data_lake_catalog`);
      const seeded = new Set(existingTables.rows.map((r: any) => r.table_name));

      // Dynamic imports to break circular dependencies
      const { seedCsv } = await import("./ingestion.js");
      const { ensureUploadedFilesSynced } = await import("./catalog.js");

      if (!seeded.has("superstore_sales")) {
        await seedCsv("superstore_sales.csv", "superstore_sales", "system", "Historical sales data", false, "shared");
      } else {
        console.log("[Data Lake] superstore_sales already seeded, skipping.");
      }
      if (!seeded.has("retail_sales")) {
        await seedCsv("retail_sales_dataset.csv", "retail_sales", "system", "Retail sales dataset for testing", false, "shared");
      } else {
        console.log("[Data Lake] retail_sales already seeded, skipping.");
      }

      await pool.query(`
        UPDATE data_lake_catalog
        SET visibility = 'shared', owner_id = NULL
        WHERE table_name IN ('superstore_sales', 'retail_sales')
      `);

      await ensureUploadedFilesSynced();

      const oldTables = ["datasetdescription", "test_mixed_data", "test_int_dec", "upload_test"];
      for (const tbl of oldTables) {
        try {
          await pool.query(`DROP TABLE IF EXISTS "${tbl}" CASCADE`);
          await pool.query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [tbl]);
        } catch { /* ignore cleanup errors */ }
      }
    } catch (err: unknown) {
      console.warn(`[Data Lake] Table creation failed: ${err instanceof Error ? err.message : String(err)}`);
      _pgAvailable = false;
      _initPromise = null;
    }
  })();

  return _initPromise;
}
