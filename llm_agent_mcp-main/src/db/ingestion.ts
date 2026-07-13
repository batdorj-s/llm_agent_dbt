/**
 * ingestion.ts — CSV import, table seeding, and finance combined table merging.
 */

import fs from "fs";
import { getPool, isPgAvailable, initDataLake, quoteIdent } from "./pool.js";
import { normalizeColumnName } from "./sql-utils.js";

// ── CSV helpers ───────────────────────────────────────────────

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

// ── CSV seeding ───────────────────────────────────────────────

export async function seedCsv(
  csvPath: string,
  tableName: string,
  ownerId: string,
  description: string,
  overwrite: boolean = false,
  visibility: "private" | "shared" = "private"
) {
  await initDataLake();
  if (!isPgAvailable()) return;

  if (!fs.existsSync(csvPath)) {
    console.warn(`[Data Lake] CSV file not found: ${csvPath}`);
    return;
  }

  try {
    const checkResult = await getPool().query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = $1`,
      [tableName]
    );

    if (checkResult.rows.length > 0) {
      if (!overwrite) return;
      console.log(`[Data Lake] Table ${tableName} exists. Dropping with CASCADE...`);
      await getPool().query(`DROP TABLE IF EXISTS ${quoteIdent(tableName)} CASCADE`);
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

    await getPool().query(`CREATE TABLE ${quoteIdent(tableName)} (
      ${uniqueHeaders.map((h, i) => `"${h}" ${types[i]}`).join(",\n")}
    )`);

    const insertSql = `INSERT INTO ${quoteIdent(tableName)} (${uniqueHeaders.map(h => `"${h}"`).join(", ")}) VALUES (${uniqueHeaders.map((_, i) => `$${i + 1}`).join(", ")})`;

    for (const row of dataRows) {
      const values = row.map((v, idx) => {
        const cleaned = v.replace(/^["']|["']$/g, "");
        if (types[idx] === "INTEGER" || types[idx] === "NUMERIC") return cleanNumeric(cleaned) || "0";
        return cleaned;
      });
      await getPool().query(insertSql, [...values, ...Array(uniqueHeaders.length).fill("")].slice(0, uniqueHeaders.length));
    }

    const columnsInfo = JSON.stringify(uniqueHeaders);
    await getPool().query(`
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
  } catch (err: unknown) {
    console.error(`[Data Lake] Error seeding ${tableName}:`, err instanceof Error ? err.message : String(err));
  }
}

// ── Finance combined table ────────────────────────────────────

export const FINANCE_COMBINED_TABLE = "finance_combined";

const FINANCE_SCHEMA_COLUMNS = new Set(["date", "customer", "amount", "category", "subcategory", "description"]);

function isFinanceTableSchema(columns: string[]): boolean {
  const lower = new Set(columns.map(c => c.toLowerCase()));
  return FINANCE_SCHEMA_COLUMNS.size === lower.size
    && [...FINANCE_SCHEMA_COLUMNS].every(c => lower.has(c));
}

function resolveFinanceYear(tableName: string): number {
  const m = tableName.match(/_(\d{4})(?:_|$)/);
  return m ? parseInt(m[1], 10) : new Date().getFullYear();
}

export async function mergeIntoCombined(
  uploadedTableName: string,
  ownerId: string,
  description: string,
): Promise<void> {
  if (!isPgAvailable()) return;
  const p = getPool();

  const catalogResult = await p.query(
    `SELECT columns_info FROM data_lake_catalog WHERE table_name = $1`,
    [uploadedTableName]
  );
  if (catalogResult.rows.length === 0) return;
  const columns: string[] = JSON.parse(catalogResult.rows[0].columns_info as string);
  if (!isFinanceTableSchema(columns)) return;

  const combined = FINANCE_COMBINED_TABLE;
  const uTbl = quoteIdent(uploadedTableName);
  const cTbl = quoteIdent(combined);

  const year = resolveFinanceYear(uploadedTableName);
  const selectCols = columns.map(c => {
    const qc = `"${c.replace(/"/g, '""')}"`;
    if (c.toLowerCase() === "date") {
      return `TO_DATE(NULLIF(${uTbl}.${qc}, '') || '-${year}', 'DD-Mon-YYYY') AS ${qc}`;
    }
    return `${uTbl}.${qc}`;
  });
  const insertCols = columns.map(c => `"${c.replace(/"/g, '""')}"`).join(", ");

  const existsResult = await p.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name = $1`,
    [combined]
  );

  if (existsResult.rows.length === 0) {
    await p.query(`CREATE TABLE ${cTbl} AS SELECT ${selectCols.join(", ")} FROM ${uTbl}`);
    console.log(`[Data Lake] Created combined table '${combined}'`);
  } else {
    const matchCols = columns.map(c => {
      const qc = `"${c.replace(/"/g, '""')}"`;
      if (c.toLowerCase() === "date") {
        return `TO_DATE(NULLIF(${uTbl}.${qc}, '') || '-${year}', 'DD-Mon-YYYY') IS NOT DISTINCT FROM ${cTbl}.${qc}`;
      }
      return `${uTbl}.${qc} IS NOT DISTINCT FROM ${cTbl}.${qc}`;
    }).join(" AND ");

    await p.query(`
      INSERT INTO ${cTbl} (${insertCols})
      SELECT ${selectCols.join(", ")} FROM ${uTbl}
      WHERE NOT EXISTS (
        SELECT 1 FROM ${cTbl} WHERE ${matchCols}
      )
    `);
    console.log(`[Data Lake] Merged '${uploadedTableName}' into '${combined}'`);
  }

  await p.query(`DROP TABLE IF EXISTS ${quoteIdent(uploadedTableName)} CASCADE`);

  const existingCombined = await p.query(
    `SELECT table_name FROM data_lake_catalog WHERE table_name = $1`,
    [combined]
  );

  if (existingCombined.rows.length === 0) {
    await p.query(`
      INSERT INTO data_lake_catalog (table_name, created_by, owner_id, visibility, columns_info, description)
      VALUES ($1, $2, $3, 'private', $4, $5)
    `, [combined, ownerId, ownerId, JSON.stringify(columns), description]);
  } else {
    await p.query(`
      UPDATE data_lake_catalog SET description = $1, created_at = NOW() WHERE table_name = $2
    `, [description, combined]);
  }

  await p.query(`
    INSERT INTO uploaded_files (id, filename, type, description, generated_at, owner_id, visibility)
    VALUES ($1, $2, 'dataset', $3, NOW(), $4, 'private')
    ON CONFLICT (id) DO UPDATE SET
      filename = EXCLUDED.filename, description = EXCLUDED.description, generated_at = NOW()
  `, [combined, `${combined} (auto-merged)`, description, ownerId]);

  await p.query(`DELETE FROM uploaded_files WHERE id = $1`, [uploadedTableName]);

  console.log(`[Data Lake] Catalog updated: '${combined}' is now the active table`);
}
