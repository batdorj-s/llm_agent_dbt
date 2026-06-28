/**
 * init.ts — Bootstrap Data Lake, seed CSVs, and optionally run dbt
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { initDataLake, getCatalog } from "../db/data-lake.js";

dotenv.config();

const ROOT = process.cwd();
const DBT_PROJECT_DIR = process.env.DBT_PROJECT_DIR || path.join(ROOT, "dbt");
const REQUIRED_CSVS = ["superstore_sales.csv", "retail_sales_dataset.csv"] as const;

// Resolve dbt path: env var > known hermes venv > PATH fallback
function resolveDbtPath(): string {
  if (process.env.DBT_PATH) {
    console.log(`[Setup] Using DBT_PATH from .env: ${process.env.DBT_PATH}`);
    return process.env.DBT_PATH;
  }
  const knownPaths = [
    "/Users/batdorjsukhbaatar/Library/Python/3.9/bin/dbt",
    "C:\\Users\\Pixel PC 01\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\dbt.exe",
  ];
  for (const p of knownPaths) {
    if (fs.existsSync(p)) return p;
  }
  return "dbt";
}

const DBT_EXE = resolveDbtPath();

function runDbt(args: string): void {
  execSync(`"${DBT_EXE}" ${args}`, { cwd: DBT_PROJECT_DIR, stdio: "inherit" });
}

export function dbtAvailable(): boolean {
  try {
    runDbt("--version");
    return true;
  } catch {
    return false;
  }
}

function runDbtIfAvailable() {
  if (!dbtAvailable()) {
    console.log("[Setup] dbt not installed — skipping view creation (KPI fallback will be used)");
    return;
  }

  try {
    console.log("[Setup] Installing dbt packages...");
    runDbt("deps --profiles-dir .");
    console.log("[Setup] Running dbt to create KPI views...");
    runDbt("run --profiles-dir .");
    console.log("[Setup] dbt run complete [OK]");
  } catch (err) {
    console.warn("[Setup] dbt run failed — KPI repository will use raw-table fallback:", (err as Error).message);
  }
}

export function runDbtForTable(inputTable: string, columns?: string[], mapping?: Record<string, string | null>): void {
  if (!dbtAvailable()) {
    console.log(`[dbt] not installed — skipping dbt for '${inputTable}'`);
    return;
  }
  try {
    console.log(`[dbt] Running pipeline for '${inputTable}'...`);
    const vars = JSON.stringify({
      input_table: inputTable,
      sales_col: mapping?.sales_col || null,
      date_col: mapping?.date_col || null,
      customer_col: mapping?.customer_col || null,
      segment_col: mapping?.segment_col || null,
      category_col: mapping?.category_col || null,
      profit_col: mapping?.profit_col || null,
      id_col: mapping?.id_col || null,
      region_col: mapping?.region_col || null,
    });
    runDbt(`run --vars '${vars}' --profiles-dir .`);
    console.log(`[dbt] Pipeline complete for '${inputTable}' [OK]`);
  } catch (err) {
    console.warn(`[dbt] Pipeline failed for '${inputTable}':`, (err as Error).message);
  }
}

export function runDbtTest(vars: string): string {
  if (!dbtAvailable()) return "dbt not available";
  try {
    return execSync(`"${DBT_EXE}" test --vars '${vars}' --profiles-dir .`, {
      cwd: DBT_PROJECT_DIR,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (err: any) {
    return err.stdout || err.message || "Test execution failed";
  }
}

export async function ensureProjectReady() {
  console.log("[Setup] Initializing Data Lake...");

  for (const csv of REQUIRED_CSVS) {
    const csvPath = path.join(ROOT, csv);
    if (!fs.existsSync(csvPath)) {
      console.warn(`[Setup] Missing seed CSV: ${csv} (expected at project root)`);
    }
  }

  await initDataLake();
  const catalog = await getCatalog("system");
  console.log(`[Setup] Data Lake ready — ${catalog.length} table(s) in catalog`);

  runDbtIfAvailable();
}

// Executed via: npm run setup
if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/setup/init.ts")) {
  ensureProjectReady().catch(console.error);
}
