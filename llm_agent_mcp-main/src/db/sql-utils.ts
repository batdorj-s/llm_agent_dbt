/**
 * sql-utils.ts — SQL validation, column normalization, noise filters, and query execution.
 */

import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { parse as parseSql } from "pgsql-ast-parser";
import { getPool, isPgAvailable, initDataLake, type DataLakeCatalogEntry } from "./pool.js";
import { getCatalog } from "./catalog.js";
import { traceToolCall } from "../observability/tracer.js";

// ── Constants ─────────────────────────────────────────────────

const AGG_FUNCS = "count|sum|avg|min|max|coalesce|nullif|abs|round|ceil|floor|trunc|power|sqrt|replace|trim|lower|upper|length|total|group_concat|string_agg|array_agg|json_agg|jsonb_agg|bool_and|bool_or|every|bit_and|bit_or|corr|covar_samp|covar_pop|regr_slope|regr_intercept|regr_count|regr_r2|regr_avgx|regr_avgy|regr_sxx|regr_syy|regr_sxy|stddev|stddev_samp|stddev_pop|variance|var_samp|var_pop|percentile_cont|percentile_disc|mode|rank|row_number|dense_rank|ntile|lag|lead|first_value|last_value|nth_value|cume_dist|percent_rank|to_date|to_char|to_timestamp|to_number|date_trunc|extract|date_part|date_add|date_sub|datediff|date_format";
const SQL_FUNCS = new Set("to_date|to_char|to_timestamp|to_number|date_trunc|extract|date_part|date_add|date_sub|datediff|date_format|str_to_date|cast|convert|position|substring|substr|concat|format|locate|instr|left|right|repeat|space|pad|lpad|rpad|initcap|reverse|translate|chr|ascii|encode|decode|md5|sha1|sha2|sha256|sha512|gen_random_uuid|now|current_date|current_time|current_timestamp|localtime|localtimestamp|timezone|age|isfinite|justify_days|justify_hours|justify_interval|make_date|make_time|make_timestamp|make_timestamptz|overlay".split("|"));

const ALLOWED_STMT_TYPES = new Set(["select", "with"]);

// ── Column normalization ──────────────────────────────────────

function loadMongolianColumnMap(): Record<string, string> {
  const configPath = path.resolve("config/mongolian-columns.yml");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = parseYaml(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    console.warn("[Data Lake] Could not load config/mongolian-columns.yml — using empty column map.");
    return {};
  }
}

const MONGOLIAN_COLUMN_MAP: Record<string, string> = loadMongolianColumnMap();

export function normalizeColumnName(columnName: string): string {
  const trimmed = columnName.trim().replace(/^["']|["']$/g, "");
  const lowerTrimmed = trimmed.toLowerCase();
  if (MONGOLIAN_COLUMN_MAP[lowerTrimmed]) {
    return MONGOLIAN_COLUMN_MAP[lowerTrimmed];
  }
  return trimmed
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase() || "col";
}

// ── Noise subcategory filter ──────────────────────────────────

function loadNoiseSubcategoriesRaw(): string[] {
  const configPath = path.resolve("config/noise-subcategories.yml");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = parseYaml(raw) as { noise_subcategories?: string[] };
    return Array.isArray(parsed?.noise_subcategories) ? parsed.noise_subcategories : [];
  } catch {
    console.warn("[Data Lake] Could not load config/noise-subcategories.yml — using default noise list.");
    return ["Бусад", "Касс руу хийв", "Дотоод шилжүүлэг"];
  }
}

const NOISE_SUBCATEGORIES: string[] = loadNoiseSubcategoriesRaw();

export function buildNoiseSubcategoryFilter(quotedCol: string): string {
  const list = NOISE_SUBCATEGORIES.map(s => `'${s.toLowerCase().replace(/'/g, "''")}'`).join(", ");
  return `LOWER(${quotedCol}) NOT IN (${list})`;
}

// ── SQL statement validation ──────────────────────────────────

export function assertSelectOnly(query: string): void {
  try {
    const statements = parseSql(query);
    if (statements.length !== 1) {
      throw new Error(`Expected exactly 1 statement, got ${statements.length}`);
    }
    if (!ALLOWED_STMT_TYPES.has(statements[0].type)) {
      throw new Error(`Only SELECT queries are permitted. Got "${(statements[0] as any).type ?? "unknown"}" statement.`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("Only SELECT") || msg.startsWith("Expected exactly")) {
      throw err;
    }
    throw new Error(`Only SELECT queries are permitted. Query could not be parsed: ${msg}`);
  }
}

// ── CTE extraction ────────────────────────────────────────────

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

// ── SELECT column splitting ───────────────────────────────────

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

// ── Column validation ─────────────────────────────────────────

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
      const dotParts = cleanName.split('.');
      if (dotParts.length === 2) {
        const tblAlias = dotParts[0].replace(/["`]/g, '').toLowerCase();
        const col = dotParts[1].replace(/["`]/g, '').toLowerCase();
        const resolvedTable = (aliasToTable?.get(tblAlias) || tblAlias).toLowerCase();
        if (resolvedTable === tableName.toLowerCase() && !columnNamesLower.has(col)) {
          if (!new RegExp(`^(${AGG_FUNCS})\\s*\\(`, "i").test(col)) {
            throw new Error(`Хүснэгт '${tableName}'-д '${dotParts[1]}' багана байхгүй. Боломжтой: ${columns.join(", ")}`);
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

  for (const [_alias, tableName] of aliasToTable) {
    const entry = tableColumnsMap.get(tableName);
    if (!entry) {
      const available = Array.from(tableColumnsMap.keys()).join(", ");
      throw new Error(`Хүснэгт '${tableName}' байхгүй байна. Боломжтой хүснэгтүүд: ${available}`);
    }
    validateSelectColumns(query, entry.columns, new Set(entry.columns.map(c => c.toLowerCase())), tableName, aliasToTable);
  }
}

export async function validateSqlColumns(query: string, userId: string) {
  const catalog = await getCatalog(userId);
  if (!catalog || catalog.length === 0) throw new Error("Catalog is empty — no tables to validate against.");
  validateSqlColumnsAgainstCatalog(query, catalog);
}

// ── SQL execution safeguards ──────────────────────────────────

export const SQL_STATEMENT_TIMEOUT_MS = parseInt(process.env.PG_STATEMENT_TIMEOUT_MS || "30000", 10);
export const SQL_MAX_RESULT_ROWS = parseInt(process.env.PG_MAX_RESULT_ROWS || "10000", 10);

function enforceMaxRows(query: string, maxRows: number): string {
  const trimmed = query.trim();
  try {
    const statements = parseSql(trimmed);
    if (statements.length !== 1) return trimmed;
    const stmt = statements[0];
    if (stmt.type === "select" && !(stmt as any).limit) {
      const clean = trimmed.replace(/;+\s*$/, "");
      return `${clean} LIMIT ${maxRows};`;
    }
  } catch {
    // If parsing fails, fall back to regex heuristic
    if (/^select\b/i.test(trimmed) && !/\blimit\b/i.test(trimmed)) {
      const clean = trimmed.replace(/;+\s*$/, "");
      return `${clean} LIMIT ${maxRows};`;
    }
  }
  return trimmed;
}

// ── SQL execution ─────────────────────────────────────────────

export async function executeSql(query: string, readOnly: boolean, userId: string): Promise<any> {
  return traceToolCall("executeSql", async () => {
    await initDataLake();
    if (!isPgAvailable()) throw new Error("Data Lake unavailable (PostgreSQL not connected).");

    assertSelectOnly(query);
    await validateSqlColumns(query, userId);

    const safeQuery = enforceMaxRows(query, SQL_MAX_RESULT_ROWS);

    try {
      await getPool().query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");
      await getPool().query(`SET LOCAL statement_timeout = '${SQL_STATEMENT_TIMEOUT_MS}ms'`);
      const result = await getPool().query(safeQuery);
      await getPool().query("ROLLBACK");
      return result.rows;
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const msg = rawMsg
        .replace(/^syntax error at or near/, "SQL syntax error near")
        .replace(/^ERROR:\s*/i, "");
      throw new Error(`SQL Execution Error: ${msg}`);
    }
  }, { readOnly, userId });
}
