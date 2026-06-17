import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

let db: Database.Database;

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

export function getActiveCatalogEntry(): DataLakeCatalogEntry | null {
    initDataLake();

    const uploadedDataset = db.prepare(`
        SELECT filename
        FROM uploaded_files
        WHERE type = 'dataset'
        ORDER BY created_at DESC
        LIMIT 1
    `).get() as { filename?: string } | undefined;

    if (uploadedDataset?.filename) {
        const activeRow = db.prepare(`
            SELECT *
            FROM data_lake_catalog
            WHERE table_name = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        `).get(uploadedDataset.filename) as DataLakeCatalogEntry | undefined;

        if (activeRow) {
            return activeRow;
        }
    }

    const catalog = getCatalog();
    return (catalog[0] as DataLakeCatalogEntry) ?? null;
}

export function buildSchemaDefinition(entries: DataLakeCatalogEntry | DataLakeCatalogEntry[] | null = getActiveCatalogEntry()): string {
    if (!entries) {
        return "No active table schema is available.";
    }

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
    if (!/^with\b/i.test(trimmed)) {
        return cteNames;
    }

    const ctePattern = /([a-zA-Z0-9_]+)\s+as\s*\(/gi;
    let match;
    while ((match = ctePattern.exec(query)) !== null) {
        cteNames.add(match[1].toLowerCase());
    }

    return cteNames;
}

// 1. Initialize SQLite Database
export function initDataLake() {
    if (db) return db;

    const dbPath = path.resolve(process.cwd(), "datalake.db");
    db = new Database(dbPath, { timeout: 5000 }); // Wait up to 5 seconds if DB is busy

    console.log("[Data Lake] Initializing SQLite Data Lake at", dbPath);

    // Create Catalog Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS data_lake_catalog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT UNIQUE NOT NULL,
            created_by TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            columns_info TEXT,
            description TEXT
        )
    `);

    // Create File Registry
    db.exec(`
        CREATE TABLE IF NOT EXISTS uploaded_files (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            type TEXT NOT NULL,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Auto-seed superstore_sales if missing
    seedCsv("superstore_sales.csv", "superstore_sales", "Admin", "Historical sales data");
    seedCsv("retail_sales_dataset.csv", "retail_sales", "Admin", "Retail sales dataset for testing");

    return db;
}

/**
 * Robust CSV line splitter that respects quoted values
 */
function splitCsvLine(line: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuotes = !inQuotes;
        } else if (c === "," && !inQuotes) {
            result.push(cur.trim());
            cur = "";
        } else {
            cur += c;
        }
    }
    result.push(cur.trim());
    return result;
}

/**
 * Clean numeric strings for database storage
 */
function cleanNumeric(val: string): string {
    if (!val) return "";
    // Remove currency symbols and thousands separators, but keep decimal point and negative sign
    return val.replace(/[$,]/g, "").trim();
}

/**
 * Infer SQLite type from string value
 */
function inferType(val: string): "INTEGER" | "REAL" | "TEXT" {
    const cleaned = cleanNumeric(val);
    if (!cleaned) return "TEXT";
    if (/^-?\d+$/.test(cleaned)) return "INTEGER";
    if (/^-?\d*\.\d+$/.test(cleaned) || /^-?\d+\.\d*$/.test(cleaned)) return "REAL";
    return "TEXT";
}

// 2. Read CSV and insert into SQLite
export function seedCsv(csvPath: string, tableName: string, createdBy: string, description: string, overwrite: boolean = false) {
    if (!fs.existsSync(csvPath)) {
        console.warn(`[Data Lake] CSV file not found: ${csvPath}`);
        return;
    }

    try {
        const checkTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`);
        if (checkTable.get(tableName)) {
            if (!overwrite) {
                return;
            }
            console.log(`[Data Lake] Table ${tableName} exists. Dropping for fresh seed...`);
            db.exec(`DROP TABLE IF EXISTS "${tableName}"`);
        }

        console.log(`[Data Lake] Seeding ${tableName} from ${csvPath}...`);
        const fileContent = fs.readFileSync(csvPath, "utf-8");
        const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== "");
        if (lines.length < 2) {
            console.warn(`[Data Lake] CSV file ${csvPath} has no data rows.`);
            return;
        }

        // Parse Headers
        const rawHeaders = splitCsvLine(lines[0]);
        const headers = rawHeaders.map(normalizeColumnName);

        // Ensure unique headers
        const uniqueHeaders: string[] = [];
        const seen = new Set<string>();
        for (let h of headers) {
            let base = h || "col";
            let count = 1;
            let finalH = h;
            while (seen.has(finalH)) {
                finalH = `${base}_${count++}`;
            }
            seen.add(finalH);
            uniqueHeaders.push(finalH);
        }

        // 3. Infer Column Types from first data row
        const firstRow = splitCsvLine(lines[1]);
        const types = firstRow.map(val => inferType(val));

        const createTableSql = `CREATE TABLE "${tableName}" (
            ${uniqueHeaders.map((h, i) => `"${h}" ${types[i]}`).join(",\n")}
        )`;
        
        console.log(`[Data Lake] Creating table with schema:\n${createTableSql}`);
        db.exec(createTableSql);

        // Insert Rows
        const insertSql = `INSERT INTO "${tableName}" (${uniqueHeaders.map(h => `"${h}"`).join(", ")}) VALUES (${uniqueHeaders.map(() => "?").join(", ")})`;
        const insertStmt = db.prepare(insertSql);
        
        const insertMany = db.transaction((rows: string[]) => {
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i].trim();
                if (!row) continue;
                const values = splitCsvLine(row).map((v, idx) => {
                    const cleaned = v.replace(/^["']|["']$/g, "");
                    if (types[idx] === "INTEGER" || types[idx] === "REAL") {
                        return cleanNumeric(cleaned);
                    }
                    return cleaned;
                });
                
                // Pad or truncate values to match headers length
                const paddedValues = [...values, ...Array(uniqueHeaders.length).fill("")].slice(0, uniqueHeaders.length);
                insertStmt.run(...paddedValues);
            }
        });
        
        insertMany(lines);

        // Register in Catalog
        const columnsInfo = JSON.stringify(uniqueHeaders);
        db.prepare(`
            INSERT INTO data_lake_catalog (table_name, created_by, columns_info, description)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(table_name) DO UPDATE SET 
                columns_info=excluded.columns_info,
                description=excluded.description,
                created_at=CURRENT_TIMESTAMP
        `).run(tableName, createdBy, columnsInfo, description);

        console.log(`[Data Lake] Successfully seeded ${tableName}`);
    } catch (err: any) {
        console.error(`[Data Lake] Error seeding ${tableName}:`, err.message);
        throw err; // Re-throw to inform caller
    }
}

// 3. Get Catalog (MCP Tool)
export function getCatalog() {
    initDataLake();
    const rows = db.prepare(`SELECT * FROM data_lake_catalog ORDER BY created_at DESC, id DESC`).all();
    return rows as DataLakeCatalogEntry[];
}

/**
 * Validate that the SQL query only references columns that exist in the active tables.
 * This prevents the agent from hallucinating column names.
 */
export function validateSqlColumns(query: string) {
    const catalog = getCatalog();
    const cteNames = getCteNames(query);
    const activeEntry = getActiveCatalogEntry();
    const activeTableName = activeEntry?.table_name?.toLowerCase() ?? "";
    
    // Parse table names referenced in the query using regex
    const tableMatches = query.match(/(?:from|join)\s+["`]?([a-zA-Z0-9_]+)["`]?/gi);
    if (!tableMatches) return;
    
    const tablesInQuery = tableMatches.map(m => 
        m.replace(/^(from|join)\s+/i, "")
         .replace(/["`]/g, "")
         .trim()
    );

    const queryWords = query.match(/[a-zA-Z0-9_]+/g) || [];
    const uniqueWords = Array.from(new Set(queryWords.map(w => w.toLowerCase())));

    for (const tableName of tablesInQuery) {
        if (cteNames.has(tableName.toLowerCase())) {
            continue;
        }

        if (activeTableName && tableName.toLowerCase() !== activeTableName) {
            throw new Error(`SQL query references table '${tableName}', but the active dataset is '${activeEntry?.table_name}'. Use only the active dataset unless a CTE is being referenced.`);
        }

        const tableEntry = catalog.find(row => row.table_name.toLowerCase() === tableName.toLowerCase()) || activeEntry;
        if (!tableEntry) {
            throw new Error(`SQL query references unknown table '${tableName}'. Use only tables from the active Data Lake catalog.`);
        }

        const columns: string[] = JSON.parse(tableEntry.columns_info);
        
        // Check for dot-notation column references: table_name.col_name
        const dotRegex = new RegExp(`["\`]?${tableName}["\`]?\\s*\\.\\s*["\`]?([a-zA-Z0-9_]+)["\`]?`, "gi");
        let dotMatch;
        while ((dotMatch = dotRegex.exec(query)) !== null) {
            const colName = dotMatch[1].toLowerCase();
            const colExists = columns.some(c => c.toLowerCase() === colName);
            if (!colExists) {
                throw new Error(`Хүснэгт '${tableName}' нь '${dotMatch[1]}' гэсэн багана агуулаагүй байна. Боломжтой баганууд: ${columns.join(", ")}`);
            }
        }
        
        // Check for column references from OTHER tables that are used in this single-table query
        if (tablesInQuery.length === 1) {
            const otherTables = catalog.filter(row => row.table_name.toLowerCase() !== tableName.toLowerCase());
            for (const otherTable of otherTables) {
                const otherColumns: string[] = JSON.parse(otherTable.columns_info);
                for (const otherCol of otherColumns) {
                    if (uniqueWords.includes(otherCol.toLowerCase())) {
                        const inTarget = columns.some(c => c.toLowerCase() === otherCol.toLowerCase());
                        if (!inTarget) {
                            throw new Error(`SQL query references column '${otherCol}' which belongs to table '${otherTable.table_name}', but the target table is '${tableName}'. '${tableName}' table columns are: ${columns.join(", ")}`);
                        }
                    }
                }
            }
        }
    }
}

// 4. Execute SQL (MCP Tool / Agent)
export function executeSql(query: string) {
    initDataLake();
    
    // Validate SQL query references
    validateSqlColumns(query);

    try {
        const isSelect = query.trim().toUpperCase().startsWith("SELECT") || query.trim().toUpperCase().startsWith("WITH");
        if (isSelect) {
            return db.prepare(query).all();
        } else {
            const info = db.prepare(query).run();
            return { message: "Query executed successfully", changes: info.changes };
        }
    } catch (err: any) {
        throw new Error(`SQL Execution Error: ${err.message}`);
    }
}
