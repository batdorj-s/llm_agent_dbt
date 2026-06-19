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
  execSync(`"${DBT_EXE}" ${args}`, { cwd: path.join(ROOT, "dbt"), stdio: "inherit" });
}

function dbtAvailable(): boolean {
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
    console.log("[Setup] dbt run complete ✅");
  } catch (err) {
    console.warn("[Setup] dbt run failed — KPI repository will use raw-table fallback:", (err as Error).message);
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
  const catalog = await getCatalog();
  console.log(`[Setup] Data Lake ready — ${catalog.length} table(s) in catalog`);

  runDbtIfAvailable();
}

// Executed via: npm run setup
if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/setup/init.ts")) {
  ensureProjectReady().catch(console.error);
}
