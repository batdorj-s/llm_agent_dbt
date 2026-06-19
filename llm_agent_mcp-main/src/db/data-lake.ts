import { Pool } from "pg";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

let pool: Pool | null = null;
let _pgAvailable = false;

export type DataLakeCatalogEntry = {
    id: number;
    table_name: string;
    created_by: string | null;
    created_at: string;
    columns_info: string;
    description: string | null;
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

const DANGEROUS_SQL = /\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|REPLACE|TRUNCATE|GRANT|REVOKE)\b/i;

export async function initDataLake(): Promise<void> {
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
        _pgAvailable = true;
    } catch (err: any) {
        const errMsg = (err as Error).message;
        console.warn(`[Data Lake] PostgreSQL unavailable: ${errMsg}`);
        await pool.end().catch(() => {});
        pool = null;
        _pgAvailable = false;
        return;
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS data_lake_catalog (
                id SERIAL PRIMARY KEY,
                table_name TEXT UNIQUE NOT NULL,
                created_by TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                columns_info TEXT,
                description TEXT
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                type TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS kpi_targets (
                metric_name TEXT PRIMARY KEY,
                target_value REAL NOT NULL,
                unit TEXT NOT NULL
            )
        `);

        const existing = await pool.query("SELECT metric_name FROM kpi_targets");
        if (existing.rows.length === 0) {
            await pool.query("INSERT INTO kpi_targets (metric_name, target_value, unit) VALUES ($1, $2, $3)", ["sales", 500000, "USD"]);
            await pool.query("INSERT INTO kpi_targets (metric_name, target_value, unit) VALUES ($1, $2, $3)", ["users", 2000, "users"]);
            await pool.query("INSERT INTO kpi_targets (metric_name, target_value, unit) VALUES ($1, $2, $3)", ["churn_rate", 2.0, "%"]);
        }

        console.log("[Data Lake] Connected to PostgreSQL ✅");
        await seedCsv("superstore_sales.csv", "superstore_sales", "Admin", "Historical sales data");
        await seedCsv("retail_sales_dataset.csv", "retail_sales", "Admin", "Retail sales dataset for testing");
    } catch (err: any) {
        console.warn(`[Data Lake] Table creation failed: ${(err as Error).message}`);
    }
}

export async function getActiveCatalogEntry(): Promise<DataLakeCatalogEntry | null> {
    if (!_pgAvailable) await initDataLake();
    if (!_pgAvailable || !pool) return null;

    try {
        const uploadedResult = await pool.query(`
            SELECT filename FROM uploaded_files WHERE type = 'dataset'
            ORDER BY created_at DESC LIMIT 1
        `);
        const uploadedDataset = uploadedResult.rows[0] as { filename?: string } | undefined;

        if (uploadedDataset?.filename) {
            const activeResult = await pool.query(`
                SELECT * FROM data_lake_catalog WHERE table_name = $1
                ORDER BY created_at DESC, id DESC LIMIT 1
            `, [uploadedDataset.filename]);
            if (activeResult.rows[0]) return activeResult.rows[0] as DataLakeCatalogEntry;

            const allEntries = await getCatalog();
            const match = allEntries.find(r => r.table_name.toLowerCase() === uploadedDataset.filename!.toLowerCase());
            if (match) return match;

            console.warn(`[Data Lake] Uploaded file '${uploadedDataset.filename}' not found.`);
        }

        const catalog = await getCatalog();
        return catalog[0] ?? null;
    } catch {
        return null;
    }
}

export function buildSchemaDefinition(entries: DataLakeCatalogEntry | DataLakeCatalogEntry[] | null): string {
    if (!entries) return "No active table schema is available.";
    const tables = Array.isArray(entries) ? entries : [entries];
    return tables.map((entry) => {
        const columns = JSON.parse(entry.columns_info) as string[];
        return [
            `Table: ${entry.table_name}`,
            entry.description ? `Description: ${entry.description}` : "Description: N/A",
            "Columns:",
            ...columns.map((column) => `- ${column}`),
        ].join("\n");
    }).join("\n\n");
}

function getCteNames(query: string): Set<string> {
    const cteNames = new Set<string>();
    const trimmed = query.trimStart();
    if (!/^with\b/i.test(trimmed)) return cteNames;
    const ctePattern = /([a-zA-Z0-9_]+)\s+as\s*\(/gi;
    let match;
    while ((match = ctePattern.exec(query)) !== null) cteNames.add(match[1].toLowerCase());
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

function pgType(val: string): string {
    const cleaned = cleanNumeric(val);
    if (!cleaned) return "TEXT";
    if (/^-?\d+$/.test(cleaned)) return "INTEGER";
    if (/^-?\d*\.\d+$/.test(cleaned) || /^-?\d+\.\d*$/.test(cleaned)) return "NUMERIC";
    return "TEXT";
}

export async function seedCsv(csvPath: string, tableName: string, createdBy: string, description: string, overwrite: boolean = false) {
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
            console.log(`[Data Lake] Table ${tableName} exists. Dropping...`);
            await pool.query(`DROP TABLE IF EXISTS "${tableName}"`);
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

        const firstRow = splitCsvLine(lines[1]);
        const types = firstRow.map(val => pgType(val));

        await pool.query(`CREATE TABLE "${tableName}" (
            ${uniqueHeaders.map((h, i) => `"${h}" ${types[i]}`).join(",\n")}
        )`);

        const insertSql = `INSERT INTO "${tableName}" (${uniqueHeaders.map(h => `"${h}"`).join(", ")}) VALUES (${uniqueHeaders.map((_, i) => `$${i + 1}`).join(", ")})`;

        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].trim();
            if (!row) continue;
            const values = splitCsvLine(row).map((v, idx) => {
                const cleaned = v.replace(/^["']|["']$/g, "");
                if (types[idx] === "INTEGER" || types[idx] === "NUMERIC") return cleanNumeric(cleaned) || "0";
                return cleaned;
            });
            await pool.query(insertSql, [...values, ...Array(uniqueHeaders.length).fill("")].slice(0, uniqueHeaders.length));
        }

        const columnsInfo = JSON.stringify(uniqueHeaders);
        await pool.query(`
            INSERT INTO data_lake_catalog (table_name, created_by, columns_info, description)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (table_name) DO UPDATE SET
                columns_info=EXCLUDED.columns_info, description=EXCLUDED.description, created_at=NOW()
        `, [tableName, createdBy, columnsInfo, description]);

        console.log(`[Data Lake] Successfully seeded ${tableName}`);
    } catch (err: any) {
        console.error(`[Data Lake] Error seeding ${tableName}:`, err.message);
    }
}

export async function getCatalog(): Promise<DataLakeCatalogEntry[]> {
    await initDataLake();
    if (!_pgAvailable || !pool) return [];
    try {
        const result = await pool.query(`SELECT * FROM data_lake_catalog ORDER BY created_at DESC, id DESC`);
        return result.rows as DataLakeCatalogEntry[];
    } catch {
        return [];
    }
}

export async function validateSqlColumns(query: string) {
    const cteNames = getCteNames(query);
    const activeEntry = await getActiveCatalogEntry();
    if (!activeEntry) throw new Error("No active Data Lake catalog entry found.");

    const activeTableName = activeEntry.table_name.toLowerCase();
    const columns: string[] = JSON.parse(activeEntry.columns_info);
    const columnNamesLower = new Set(columns.map(c => c.toLowerCase()));

    const tableMatches = query.match(/(?:from|join)\s+["` ]?([a-zA-Z0-9_]+)["` ]?/gi);
    if (tableMatches) {
        const tablesInQuery = tableMatches.map(m =>
            m.replace(/^(from|join)\s+/i, "").replace(/["` ]/g, "").trim()
        );
        for (const tableName of tablesInQuery) {
            if (cteNames.has(tableName.toLowerCase())) continue;
            if (tableName.toLowerCase() !== activeTableName) {
                throw new Error(`SQL references table '${tableName}' but active dataset is '${activeEntry.table_name}'.`);
            }
            const dotRegex = new RegExp(`["\` ]?${tableName}["\` ]?\\s*\\.\\s*["\` ]?([a-zA-Z0-9_]+)["\` ]?`, "gi");
            let dotMatch;
            while ((dotMatch = dotRegex.exec(query)) !== null) {
                if (!columnNamesLower.has(dotMatch[1].toLowerCase())) {
                    throw new Error(`Хүснэгтэд '${dotMatch[1]}' багана байхгүй. Боломжтой: ${columns.join(", ")}`);
                }
            }
        }
    }
    validateSelectColumns(query, columns, columnNamesLower);
}

function validateSelectColumns(query: string, columns: string[], columnNamesLower: Set<string>): void {
    const selectMatch = query.match(/select\s+(.*?)\s+from\s+/i);
    if (!selectMatch) return;
    const parts = splitSelectColumns(selectMatch[1]);
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed || trimmed === '*') continue;
        if (/^(count|sum|avg|min|max|coalesce|ifnull|nullif|abs|round|strftime|replace|substr|length|trim|lower|upper|group_concat|total)\s*\(/i.test(trimmed)) continue;
        const asIndex = trimmed.search(/\s+as\s+/i);
        const columnPart = asIndex >= 0 ? trimmed.substring(0, asIndex).trim() : trimmed;
        if (columnPart.includes('.')) continue;
        if (columnPart.startsWith("'") || columnPart.startsWith('"')) continue;
        const cleanName = columnPart.replace(/["`]/g, '').trim();
        if (!cleanName) continue;
        if (!columnNamesLower.has(cleanName.toLowerCase())) {
            throw new Error(`Хүснэгтэд '${cleanName}' багана байхгүй. Боломжтой: ${columns.join(", ")}`);
        }
    }
}

function splitSelectColumns(clause: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < clause.length; i++) {
        const c = clause[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ',' && depth === 0) {
            if (current.trim()) result.push(current.trim());
            current = '';
            continue;
        }
        current += c;
    }
    if (current.trim()) result.push(current.trim());
    return result;
}

export async function executeSql(query: string, readOnly: boolean = true): Promise<any> {
    await initDataLake();
    if (!_pgAvailable || !pool) throw new Error("Data Lake unavailable (PostgreSQL not connected).");

    await validateSqlColumns(query);

    const normalized = query.trim().toUpperCase();
    const isSelect = normalized.startsWith("SELECT") || normalized.startsWith("WITH");

    if (readOnly && !isSelect) {
        throw new Error("Only SELECT/WITH queries allowed in read-only mode.");
    }

    try {
        const result = await pool.query(query);
        return isSelect ? result.rows : { message: "Query executed", changes: result.rowCount };
    } catch (err: any) {
        throw new Error(`SQL Execution Error: ${err.message}`);
    }
}
