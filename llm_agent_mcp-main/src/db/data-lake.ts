import { Pool } from "pg";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";
import { buildSemanticGroups, formatSemanticGroups } from "../utils.js";
import { traceToolCall } from "../observability/tracer.js";
import { hashPassword, verifyPassword } from "../auth.js";
import { parse as parseSql } from "pgsql-ast-parser";

dotenv.config();

const AGG_FUNCS = "count|sum|avg|min|max|coalesce|nullif|abs|round|ceil|floor|trunc|power|sqrt|replace|trim|lower|upper|length|total|group_concat|string_agg|array_agg|json_agg|jsonb_agg|bool_and|bool_or|every|bit_and|bit_or|corr|covar_samp|covar_pop|regr_slope|regr_intercept|regr_count|regr_r2|regr_avgx|regr_avgy|regr_sxx|regr_syy|regr_sxy|stddev|stddev_samp|stddev_pop|variance|var_samp|var_pop|percentile_cont|percentile_disc|mode|rank|row_number|dense_rank|ntile|lag|lead|first_value|last_value|nth_value|cume_dist|percent_rank|to_date|to_char|to_timestamp|to_number|date_trunc|extract|date_part|date_add|date_sub|datediff|date_format";
const SQL_FUNCS = new Set("to_date|to_char|to_timestamp|to_number|date_trunc|extract|date_part|date_add|date_sub|datediff|date_format|str_to_date|cast|convert|position|substring|substr|concat|format|locate|instr|left|right|repeat|space|pad|lpad|rpad|initcap|reverse|translate|chr|ascii|encode|decode|md5|sha1|sha2|sha256|sha512|gen_random_uuid|now|current_date|current_time|current_timestamp|localtime|localtimestamp|timezone|age|isfinite|justify_days|justify_hours|justify_interval|make_date|make_time|make_timestamp|make_timestamptz|overlay".split("|"));

let pool: Pool | null = null;
let _pgAvailable = false;
let _initPromise: Promise<void> | null = null;

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

export function normalizeColumnName(columnName: string): string {
    return columnName
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase();
}

export function getPool(): Pool {
    if (!pool) throw new Error("Data Lake not initialized.");
    return pool;
}

export function isPgAvailable(): boolean {
    return _pgAvailable;
}

const ALLOWED_STMT_TYPES = new Set(["select", "with"]);

export function assertSelectOnly(query: string): void {
  try {
    const statements = parseSql(query);
    if (statements.length !== 1) {
      throw new Error(`Expected exactly 1 statement, got ${statements.length}`);
    }
    if (!ALLOWED_STMT_TYPES.has(statements[0].type)) {
      throw new Error(`Only SELECT queries are permitted. Got "${(statements[0] as any).type ?? "unknown"}" statement.`);
    }
  } catch (err: any) {
    if (err.message?.startsWith("Only SELECT") || err.message?.startsWith("Expected exactly")) {
      throw err;
    }
    throw new Error(`Only SELECT queries are permitted. Query could not be parsed: ${err.message}`);
  }
}

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
        const isLocal = databaseUrl.includes("127.0.0.1") || databaseUrl.includes("localhost") || databaseUrl.includes("host.docker.internal");
        pool = new Pool({ connectionString: databaseUrl, ssl: isLocal ? false : { rejectUnauthorized: false } });

        try {
            await pool.query("SELECT 1");
        } catch (err: any) {
            const errMsg = (err as Error).message;
            console.warn(`[Data Lake] PostgreSQL unavailable: ${errMsg}`);
            await pool.end().catch(() => { });
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

                // Legacy migration:
                // 1. If owner_id is NULL and created_by is a real user ID, map owner_id = created_by and visibility = 'private'
                await pool.query(`
                    UPDATE data_lake_catalog
                    SET owner_id = created_by,
                        visibility = 'private'
                    WHERE owner_id IS NULL 
                      AND created_by IS NOT NULL 
                      AND created_by NOT IN ('system', 'admin')
                `);

                // 2. If owner_id is NULL and created_by is NULL, 'system', or 'admin', set visibility = 'shared'
                await pool.query(`
                    UPDATE data_lake_catalog
                    SET visibility = 'shared'
                    WHERE owner_id IS NULL 
                      AND (created_by IS NULL OR created_by IN ('system', 'admin'))
                `);

                // 3. For uploaded_files: if owner_id is NULL, set visibility = 'shared'
                await pool.query(`
                    UPDATE uploaded_files
                    SET visibility = 'shared'
                    WHERE owner_id IS NULL
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
                    query TEXT,
                    outcome TEXT NOT NULL,
                    attempts INTEGER DEFAULT 1,
                    table_name TEXT,
                    error TEXT,
                    duration_ms INTEGER,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_sql_gen_log_created_at ON sql_gen_log (created_at DESC)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_sql_gen_log_outcome ON sql_gen_log (outcome)`);

            const existing = await pool.query("SELECT metric_name FROM kpi_targets");
            if (existing.rows.length === 0) {
                await pool.query("INSERT INTO kpi_targets (metric_name, target_value, unit) VALUES ($1, $2, $3)", ["sales", 500000, "USD"]);
                await pool.query("INSERT INTO kpi_targets (metric_name, target_value, unit) VALUES ($1, $2, $3)", ["users", 2000, "users"]);
                await pool.query("INSERT INTO kpi_targets (metric_name, target_value, unit) VALUES ($1, $2, $3)", ["churn_rate", 2.0, "%"]);
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

            // Update admin credentials from env vars on every startup
            if (process.env.ADMIN_PASSWORD || process.env.ADMIN_EMAIL) {
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
                await pool.query(
                    `UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`,
                    params
                );
                console.log(`[Data Lake] Admin credentials updated from env vars`);
            }

            _pgAvailable = true;
            console.log("[Data Lake] Connected to PostgreSQL");

            const existingTables = await pool.query(`SELECT table_name FROM data_lake_catalog`);
            const seeded = new Set(existingTables.rows.map((r: any) => r.table_name));

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
                } catch {
                    // ignore cleanup errors
                }
            }
        } catch (err: any) {
            console.warn(`[Data Lake] Table creation failed: ${(err as Error).message}`);
            _pgAvailable = false;
            _initPromise = null;
        }
    })();

    return _initPromise;
}

export async function ensureUploadedFilesSynced(): Promise<void> {
    if (!_pgAvailable || !pool) return;
    try {
        await pool.query(`
            INSERT INTO uploaded_files (id, filename, type, description, semantic_groups, generated_at, owner_id, visibility)
            SELECT table_name, table_name, 'dataset', description, '{}'::jsonb, created_at, owner_id, visibility
            FROM data_lake_catalog
            WHERE owner_id IS NOT NULL
            ON CONFLICT (id) DO NOTHING
        `);
        await pool.query(`
            UPDATE uploaded_files uf
            SET owner_id = dlc.owner_id,
                visibility = dlc.visibility
            FROM data_lake_catalog dlc
            WHERE uf.id = dlc.table_name
              AND uf.type = 'dataset'
              AND dlc.owner_id IS NOT NULL
        `);
        await pool.query(`
            DELETE FROM uploaded_files
            WHERE type = 'dataset'
              AND owner_id IS NULL
        `);
    } catch (err) {
        console.warn("[Data Lake] ensureUploadedFilesSynced failed:", (err as Error).message);
    }
}

export function canAccessCatalogEntry(entry: Pick<DataLakeCatalogEntry, "owner_id" | "visibility">, userId: string): boolean {
    return entry.visibility === "shared" || entry.owner_id === userId;
}

export async function getActiveCatalogEntry(userId: string): Promise<DataLakeCatalogEntry | null> {
    if (!_pgAvailable) await initDataLake();
    if (!_pgAvailable || !pool) return null;

    try {
        const uploadedResult = await getPool().query(`
            SELECT id, filename FROM uploaded_files WHERE type = 'dataset'
              AND (visibility = 'shared' OR owner_id = $1)
            ORDER BY created_at DESC LIMIT 1
        `, [userId]);
        const uploadedDataset = uploadedResult.rows[0] as { id?: string; filename?: string } | undefined;

        if (uploadedDataset?.id) {
            const tableName = uploadedDataset.id;
            const activeResult = await getPool().query(`
                SELECT * FROM data_lake_catalog WHERE table_name = $1
                  AND (visibility = 'shared' OR owner_id = $2)
                ORDER BY created_at DESC, id DESC LIMIT 1
            `, [tableName, userId]);
            if (activeResult.rows[0]) return activeResult.rows[0] as DataLakeCatalogEntry;

            const allEntries = await getCatalog(userId);
            const match = allEntries.find(r => r.table_name.toLowerCase() === tableName.toLowerCase());
            if (match) return match;

            console.warn(`[Data Lake] Uploaded table '${tableName}' not found in catalog.`);
        }

        const catalog = await getCatalog(userId);
        if (catalog.length === 0) return null;

        console.warn(`[Data Lake] uploaded_files has no dataset entries — returning catalog[0] '${catalog[0].table_name}' as fallback`);
        return catalog[0];
    } catch {
        return null;
    }
}

export async function getColumnSamples(
    tableName: string,
    columns: string[],
    limit: number = 3
): Promise<Record<string, string[]>> {
    if (!pool || !_pgAvailable) return {};
    try {
        const samples: Record<string, string[]> = {};
        for (const col of columns) {
            try {
                const result = await pool.query(
                    `SELECT DISTINCT "${col}" AS val FROM "${tableName}" WHERE "${col}" IS NOT NULL AND "${col}" != '' LIMIT $1`,
                    [limit]
                );
                samples[col] = result.rows.map((r: any) => String(r.val)).filter(Boolean);
            } catch {
                samples[col] = [];
            }
        }
        return samples;
    } catch {
        return {};
    }
}

export async function getColumnProfile(
    tableName: string,
    columns: string[]
): Promise<Record<string, { type: string; min?: string; max?: string; distinct: number }>> {
    if (!pool || !_pgAvailable) return {};
    try {
        const profile: Record<string, { type: string; min?: string; max?: string; distinct: number }> = {};
        for (const col of columns) {
            try {
                const typeResult = await pool.query(
                    `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
                    [tableName, col]
                );
                const dataType = typeResult.rows[0]?.data_type || "unknown";
                const isNumeric = /int|numeric|decimal|real|float|double/i.test(dataType);
                let minVal: string | undefined;
                let maxVal: string | undefined;
                if (isNumeric) {
                    const rangeResult = await pool.query(
                        `SELECT MIN("${col}") AS min_val, MAX("${col}") AS max_val FROM "${tableName}"`
                    );
                    minVal = rangeResult.rows[0]?.min_val != null ? String(rangeResult.rows[0].min_val) : undefined;
                    maxVal = rangeResult.rows[0]?.max_val != null ? String(rangeResult.rows[0].max_val) : undefined;
                }
                const distinctResult = await pool.query(
                    `SELECT COUNT(DISTINCT "${col}") AS cnt FROM "${tableName}"`
                );
                const distinct = Number(distinctResult.rows[0]?.cnt) || 0;
                profile[col] = { type: dataType, min: minVal, max: maxVal, distinct };
            } catch {
                profile[col] = { type: "unknown", distinct: 0 };
            }
        }
        return profile;
    } catch {
        return {};
    }
}

export async function buildSchemaDefinition(entries: DataLakeCatalogEntry | DataLakeCatalogEntry[] | null): Promise<string> {
    if (!entries) return "No active table schema is available.";
    const tables = Array.isArray(entries) ? entries : [entries];
    const parts: string[] = [];
    for (const entry of tables) {
        const columns = JSON.parse(entry.columns_info) as string[];
        // Use cached column_profiles from catalog if available
        const cachedProfiles = entry.column_profiles || {};
        let profile = cachedProfiles;
        let samples: Record<string, string[]> = {};
        
        // If no cached profiles, fall back to live queries
        if (Object.keys(cachedProfiles).length === 0) {
            const [liveSamples, liveProfile] = await Promise.all([
                getColumnSamples(entry.table_name, columns),
                getColumnProfile(entry.table_name, columns),
            ]);
            samples = liveSamples;
            profile = liveProfile;
        } else {
            // Fetch only samples for cached profiles (faster)
            samples = await getColumnSamples(entry.table_name, columns);
        }
        
        const lines: string[] = [
            `Table: ${entry.table_name}`,
            entry.description ? `Description: ${entry.description}` : "Description: N/A",
            `Columns:`,
        ];
        for (const column of columns) {
            const p = profile[column];
            if (p) {
                const typeLabel = p.type === "integer" ? "INT" : p.type === "numeric" ? "DEC" : p.type;
                const rangeInfo = p.min !== undefined && p.max !== undefined ? ` [${p.min}..${p.max}]` : "";
                const distinctInfo = p.distinct !== undefined ? `, ${p.distinct} distinct` : "";
                lines.push(`- ${column} (${typeLabel}${distinctInfo}${rangeInfo})`);
            }
            const vals = samples[column];
            if (vals && vals.length > 0) {
                lines.push(`  Sample values: ${vals.join(", ")}`);
            }
        }
        const semanticGroups = buildSemanticGroups(columns);
        const semanticGroupsText = formatSemanticGroups(semanticGroups);
        if (semanticGroupsText !== "No semantic groups detected.") {
            lines.push(`\nSemantic Groups:\n${semanticGroupsText}`);
        }
        
        // Add known relationships
        const relationships = await getRelationships(entry.table_name);
        if (relationships.length > 0) {
            lines.push(`\nKnown Relationships:\n${relationships.join("\n")}`);
        }
        
        parts.push(lines.join("\n"));
    }
    return parts.join("\n\n");
}

export async function detectForeignKeys(tableName: string, columns: string[]): Promise<void> {
    if (!_pgAvailable || !pool) return;
    try {
        const catalogResult = await pool.query(`SELECT table_name, columns_info FROM data_lake_catalog WHERE table_name != $1`, [tableName]);
        const otherTables = catalogResult.rows as Array<{ table_name: string; columns_info: string }>;
        if (otherTables.length === 0) return;

        for (const col of columns) {
            const lowerCol = col.toLowerCase();
            // Check if column ends with _id (e.g., user_id, customer_id, product_id)
            const idMatch = lowerCol.match(/^(.+)_id$/);
            if (!idMatch) continue;

            const baseName = idMatch[1]; // e.g., "user" from "user_id"
            
            // Try to find a matching table: exact match, plural, or singular
            for (const other of otherTables) {
                const otherName = other.table_name.toLowerCase();
                const otherCols: string[] = JSON.parse(other.columns_info);
                
                // Match patterns: user -> users, user -> user, users -> user, category -> categories
                const matchesTable = otherName === baseName 
                    || otherName === `${baseName}s` 
                    || otherName === `${baseName}es`
                    || otherName.endsWith(`_${baseName}`)
                    || baseName === otherName.replace(/s$/, '')
                    || (otherName.endsWith('ies') && baseName === otherName.replace(/ies$/, 'y'));
                
                if (matchesTable) {
                    // Check if target has an 'id' column
                    const hasIdCol = otherCols.some(c => c.toLowerCase() === 'id');
                    // Or check if target has a column matching the FK
                    const matchingCol = hasIdCol ? 'id' : otherCols.find(c => c.toLowerCase() === `${baseName}_id`);
                    
                    if (matchingCol) {
                        await pool.query(`
                            INSERT INTO table_relationships (source_table, source_column, target_table, target_column, confidence)
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (source_table, source_column, target_table, target_column) DO NOTHING
                        `, [tableName, col, other.table_name, matchingCol, 0.7]);
                        console.log(`[Data Lake] Detected FK: ${tableName}.${col} → ${other.table_name}.${matchingCol}`);
                    }
                }
            }
        }
    } catch (err) {
        console.warn(`[Data Lake] FK detection error for ${tableName}:`, (err as Error).message);
    }
}

export async function getRelationships(tableName: string): Promise<string[]> {
    if (!_pgAvailable || !pool) return [];
    try {
        const result = await pool.query(`
            SELECT source_table, source_column, target_table, target_column 
            FROM table_relationships 
            WHERE source_table = $1 OR target_table = $1
            ORDER BY confidence DESC
        `, [tableName]);
        
        return result.rows.map((r: any) => 
            `${r.source_table}.${r.source_column} → ${r.target_table}.${r.target_column}`
        );
    } catch {
        return [];
    }
}

function getCteNames(query: string): Set<string> {
    const cteNames = new Set<string>();
    try {
        const statements = parseSql(query);
        for (const stmt of statements) {
            if (stmt.type === "with") {
                const bind = (stmt as any).bind;
                if (Array.isArray(bind)) {
                    for (const cte of bind) {
                        if (cte.alias?.name) {
                            cteNames.add(cte.alias.name.toLowerCase());
                        }
                    }
                }
            }
        }
    } catch {
        const trimmed = query.trimStart();
        if (!/^with\b/i.test(trimmed)) return cteNames;
        const ctePattern = /([a-zA-Z0-9_]+)\s+as\s*\(/gi;
        let match;
        while ((match = ctePattern.exec(query)) !== null) cteNames.add(match[1].toLowerCase());
    }
    return cteNames;
}

function splitCsvLine(line: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQuotes = !inQuotes;
        else if (c === "," && !inQuotes) { result.push(cur.trim()); cur = ""; }
        else cur += c;
    }
    result.push(cur.trim());
    return result;
}

function cleanNumeric(val: string): string {
    if (!val) return "";
    return val.replace(/[$,]/g, "").trim();
}

function inferColumnType(values: string[]): string {
    let hasDecimal = false;
    let allNumeric = true;
    for (const raw of values) {
        const cleaned = cleanNumeric(raw);
        if (!cleaned) { allNumeric = false; continue; }
        if (/^-?\d*\.\d+$/.test(cleaned) || /^-?\d+\.\d*$/.test(cleaned)) hasDecimal = true;
        else if (!/^-?\d+$/.test(cleaned)) allNumeric = false;
    }
    if (!allNumeric) return "TEXT";
    if (hasDecimal) return "NUMERIC";
    return "INTEGER";
}

export async function seedCsv(
    csvPath: string,
    tableName: string,
    ownerId: string,
    description: string,
    overwrite: boolean = false,
    visibility: "private" | "shared" = "private"
) {
    await initDataLake();
    if (!_pgAvailable || !pool) return;

    if (!fs.existsSync(csvPath)) {
        console.warn(`[Data Lake] CSV file not found: ${csvPath}`);
        return;
    }

    try {
        const checkResult = await pool.query(
            `SELECT table_name FROM information_schema.tables WHERE table_name = $1`,
            [tableName]
        );

        if (checkResult.rows.length > 0) {
            if (!overwrite) return;
            console.log(`[Data Lake] Table ${tableName} exists. Dropping with CASCADE...`);
            await pool.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
        }

        console.log(`[Data Lake] Seeding ${tableName}...`);
        const fileContent = fs.readFileSync(csvPath, "utf-8");
        const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== "");
        if (lines.length < 2) { console.warn(`[Data Lake] CSV ${csvPath} has no data.`); return; }

        const rawHeaders = splitCsvLine(lines[0]);
        const headers = rawHeaders.map(normalizeColumnName);

        const uniqueHeaders: string[] = [];
        const seen = new Set<string>();
        for (let h of headers) {
            let base = h || "col";
            let count = 1;
            let finalH = h;
            while (seen.has(finalH)) { finalH = `${base}_${count++}`; }
            seen.add(finalH);
            uniqueHeaders.push(finalH);
        }

        const dataRows = lines.slice(1).map(l => splitCsvLine(l.trim()));
        const columnValues = uniqueHeaders.map((_, colIdx) =>
            dataRows.map(row => (row[colIdx] || "").replace(/^["']|["']$/g, ""))
        );
        const types = columnValues.map(vals => inferColumnType(vals));

        await pool.query(`CREATE TABLE "${tableName}" (
            ${uniqueHeaders.map((h, i) => `"${h}" ${types[i]}`).join(",\n")}
        )`);

        const insertSql = `INSERT INTO "${tableName}" (${uniqueHeaders.map(h => `"${h}"`).join(", ")}) VALUES (${uniqueHeaders.map((_, i) => `$${i + 1}`).join(", ")})`;

        for (const row of dataRows) {
            const values = row.map((v, idx) => {
                const cleaned = v.replace(/^["']|["']$/g, "");
                if (types[idx] === "INTEGER" || types[idx] === "NUMERIC") return cleanNumeric(cleaned) || "0";
                return cleaned;
            });
            await pool.query(insertSql, [...values, ...Array(uniqueHeaders.length).fill("")].slice(0, uniqueHeaders.length));
        }

        const columnsInfo = JSON.stringify(uniqueHeaders);
        await pool.query(`
            INSERT INTO data_lake_catalog (table_name, created_by, owner_id, visibility, columns_info, description)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (table_name) DO UPDATE SET
                owner_id=EXCLUDED.owner_id,
                visibility=EXCLUDED.visibility,
                columns_info=EXCLUDED.columns_info,
                description=EXCLUDED.description,
                created_at=NOW()
        `, [tableName, ownerId, visibility === "shared" ? null : ownerId, visibility, columnsInfo, description]);

        console.log(`[Data Lake] Successfully seeded ${tableName}`);
    } catch (err: any) {
        console.error(`[Data Lake] Error seeding ${tableName}:`, err.message);
    }
}

export async function getCatalog(userId: string): Promise<DataLakeCatalogEntry[]> {
    await initDataLake();
    if (!_pgAvailable || !pool) return [];
    try {
        const result = await pool.query(
            `SELECT * FROM data_lake_catalog
             WHERE visibility = 'shared' OR owner_id = $1
             ORDER BY created_at DESC, id DESC`,
            [userId]
        );
        return result.rows as DataLakeCatalogEntry[];
    } catch {
        return [];
    }
}

export async function validateSqlColumns(query: string, userId: string) {
    const catalog = await getCatalog(userId);
    if (!catalog || catalog.length === 0) throw new Error("Catalog is empty — no tables to validate against.");
    validateSqlColumnsAgainstCatalog(query, catalog);
}

export function validateSqlColumnsAgainstCatalog(query: string, catalog: DataLakeCatalogEntry[]) {
    const cteNames = getCteNames(query);
    const tableColumnsMap = new Map<string, { columns: string[]; description: string }>();
    const allColumnNames = new Set<string>();
    for (const entry of catalog) {
        const cols: string[] = JSON.parse(entry.columns_info);
        tableColumnsMap.set(entry.table_name.toLowerCase(), { columns: cols, description: entry.description || "N/A" });
        for (const c of cols) allColumnNames.add(c.toLowerCase());
    }

    const aliasToTable = new Map<string, string>();
    const tableAliasPattern = /(?:from|join)\s+["`]?([a-zA-Z0-9_]+)["`]?(?:\s+(?:as\s+)?["`]?([a-zA-Z0-9_]+)["`]?)?/gi;
    let match: RegExpExecArray | null;
    while ((match = tableAliasPattern.exec(query)) !== null) {
        const tableName = match[1].toLowerCase();
        if (cteNames.has(tableName)) continue;
        if (SQL_FUNCS.has(tableName)) continue;
        if (allColumnNames.has(tableName)) continue;
        const alias = match[2] ? match[2].toLowerCase() : tableName;
        aliasToTable.set(alias, tableName);
    }

    for (const [alias, tableName] of aliasToTable) {
        const entry = tableColumnsMap.get(tableName);
        if (!entry) {
            const available = Array.from(tableColumnsMap.keys()).join(", ");
            throw new Error(`Хүснэгт '${tableName}' байхгүй байна. Боломжтой хүснэгтүүд: ${available}`);
        }
        validateSelectColumns(query, entry.columns, new Set(entry.columns.map(c => c.toLowerCase())), tableName, aliasToTable);
    }
}

function validateSelectColumns(query: string, columns: string[], columnNamesLower: Set<string>, tableName: string, aliasToTable?: Map<string, string>): void {
    const cleaned = query.replace(/^with\s+[\s\S]*?\bselect\b/i, "SELECT");
    const selectMatch = cleaned.match(/select\s+(.*?)\s+from\s+/i);
    if (!selectMatch) return;
    const parts = splitSelectColumns(selectMatch[1]);
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed || trimmed === '*') continue;
        if (new RegExp(`^(${AGG_FUNCS})\\s*\\(`, "i").test(trimmed)) continue;
        if (/^case\s+when\b/i.test(trimmed)) continue;
        const asIndex = trimmed.search(/\s+as\s+/i);
        const columnPart = asIndex >= 0 ? trimmed.substring(0, asIndex).trim() : trimmed;
        if (columnPart.startsWith("'") || columnPart.startsWith('"')) continue;
        const cleanName = columnPart.replace(/["`]/g, '').trim();
        if (!cleanName) continue;
        if (cleanName.includes('.')) {
            const parts = cleanName.split('.');
            if (parts.length === 2) {
                const tblAlias = parts[0].replace(/["`]/g, '').toLowerCase();
                const col = parts[1].replace(/["`]/g, '').toLowerCase();
                const resolvedTable = (aliasToTable?.get(tblAlias) || tblAlias).toLowerCase();
                if (resolvedTable === tableName.toLowerCase() && !columnNamesLower.has(col)) {
                    if (!new RegExp(`^(${AGG_FUNCS})\\s*\\(`, "i").test(col)) {
                        throw new Error(`Хүснэгт '${tableName}'-д '${parts[1]}' багана байхгүй. Боломжтой: ${columns.join(", ")}`);
                    }
                }
            }
            continue;
        }
        if (!columnNamesLower.has(cleanName.toLowerCase())) {
            const lowerAvailable = columns.map(c => c.toLowerCase());
            const closeMatch = lowerAvailable.find(c => c === cleanName.toLowerCase()) ? ` Санамж: '${cleanName}' гэж биш '${columns[lowerAvailable.indexOf(cleanName.toLowerCase())]}' гэж бичнэ үү.` : "";
            throw new Error(`Хүснэгт '${tableName}'-д '${cleanName}' багана байхгүй.${closeMatch} Боломжтой: ${columns.join(", ")}`);
        }
    }
}

function splitSelectColumns(clause: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let current = '';
    for (let i = 0; i < clause.length; i++) {
        const c = clause[i];
        const prev = i > 0 ? clause[i - 1] : '';
        if (c === "'" && prev !== '\\' && !inDoubleQuote) inSingleQuote = !inSingleQuote;
        else if (c === '"' && prev !== '\\' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
        else if (c === '(' && !inSingleQuote && !inDoubleQuote) depth++;
        else if (c === ')' && !inSingleQuote && !inDoubleQuote) depth--;
        else if (c === ',' && depth === 0 && !inSingleQuote && !inDoubleQuote) {
            if (current.trim()) result.push(current.trim());
            current = '';
            continue;
        }
        current += c;
    }
    if (current.trim()) result.push(current.trim());
    return result;
}

// ─────────────────────────────────────────────────────────────
// User authentication
// ─────────────────────────────────────────────────────────────

export async function authenticateUser(email: string, password: string): Promise<{ id: string; email: string; name: string; role: "viewer" | "analyst" | "admin" } | null> {
  await initDataLake();
  if (!_pgAvailable || !pool) return null;
  const result = await pool.query("SELECT id, email, name, password_hash, role FROM users WHERE email = $1", [email]);
  if (result.rows.length === 0) return null;
  const user = result.rows[0];
  if (!verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function createUser(email: string, password: string, name: string, role: "viewer" | "analyst" | "admin" = "viewer"): Promise<string | null> {
  await initDataLake();
  if (!_pgAvailable || !pool) return null;
  const id = `user_${Date.now()}`;
  const hashedPwd = hashPassword(password);
  try {
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, email, name, hashedPwd, role]
    );
    return id;
  } catch (err: any) {
    if (err.code === "23505") return null; // unique violation
    throw err;
  }
}

export async function executeSql(query: string, readOnly: boolean, userId: string): Promise<any> {
    return traceToolCall("executeSql", async () => {
        await initDataLake();
        if (!_pgAvailable || !pool) throw new Error("Data Lake unavailable (PostgreSQL not connected).");

        // Structural allowlist: only single SELECT statements are permitted.
        assertSelectOnly(query);

        await validateSqlColumns(query, userId);

        try {
            await pool.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");
            const result = await pool.query(query);
            await pool.query("ROLLBACK");
            return result.rows;
        } catch (err: any) {
            const msg = err.message
                .replace(/^syntax error at or near/, "SQL syntax error near")
                .replace(/^ERROR:\s*/i, "");
            throw new Error(`SQL Execution Error: ${msg}`);
        }
    }, { readOnly, userId });
}
