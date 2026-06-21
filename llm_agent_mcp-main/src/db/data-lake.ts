import { Pool } from "pg";
import fs from "fs";
import dotenv from "dotenv";
import { buildSemanticGroups, formatSemanticGroups } from "../utils.js";

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

export const DANGEROUS_SQL = /\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|REPLACE|TRUNCATE|GRANT|REVOKE)\b/i;

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

            try {
                await pool.query(`ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS semantic_groups JSONB DEFAULT NULL`);
                await pool.query(`ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NULL`);
            } catch (alterErr) {
                console.warn("[Data Lake] ALTER TABLE uploaded_files note:", (alterErr as Error).message);
            }

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

            _pgAvailable = true;
            console.log("[Data Lake] Connected to PostgreSQL ✅");
            await seedCsv("superstore_sales.csv", "superstore_sales", "Admin", "Historical sales data", false);
            await seedCsv("retail_sales_dataset.csv", "retail_sales", "Admin", "Retail sales dataset for testing", false);

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
        const [samples, profile] = await Promise.all([
            getColumnSamples(entry.table_name, columns),
            getColumnProfile(entry.table_name, columns),
        ]);
        const lines: string[] = [
            `Table: ${entry.table_name}`,
            entry.description ? `Description: ${entry.description}` : "Description: N/A",
            `Total distinct values per column:`,
        ];
        for (const column of columns) {
            const p = profile[column];
            if (p) {
                const typeLabel = p.type === "integer" ? "INT" : p.type === "numeric" ? "DEC" : p.type;
                const rangeInfo = p.min !== undefined && p.max !== undefined ? ` [${p.min}..${p.max}]` : "";
                lines.push(`- ${column} (${typeLabel}, ${p.distinct} distinct${rangeInfo})`);
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
        parts.push(lines.join("\n"));
    }
    return parts.join("\n\n");
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
    const catalog = await getCatalog();
    if (!catalog || catalog.length === 0) throw new Error("Catalog is empty — no tables to validate against.");

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

export async function executeSql(query: string, readOnly: boolean = true): Promise<any> {
    await initDataLake();
    if (!_pgAvailable || !pool) throw new Error("Data Lake unavailable (PostgreSQL not connected).");

    if (DANGEROUS_SQL.test(query)) {
        throw new Error("Only SELECT/WITH queries are permitted. Mutating operations are strictly prohibited.");
    }

    await validateSqlColumns(query);

    const normalized = query.trim().toUpperCase();
    const isSelect = /^\s*SELECT\b/i.test(normalized) || (/^\s*WITH\b/i.test(normalized) && /SELECT\b/i.test(normalized.replace(/^\s*WITH[\s\S]*?SELECT\b/i, "")));

    if (readOnly && !isSelect) {
        throw new Error("Only SELECT/WITH queries allowed in read-only mode.");
    }

    try {
        if (isSelect) {
            await pool.query(`EXPLAIN ${query}`);
        }
        const result = await pool.query(query);
        return isSelect ? result.rows : { message: "Query executed", changes: result.rowCount };
    } catch (err: any) {
        const msg = err.message
            .replace(/^syntax error at or near/, "SQL syntax error near")
            .replace(/^ERROR:\s*/i, "");
        throw new Error(`SQL Execution Error: ${msg}`);
    }
}
