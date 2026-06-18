/**
 * init.ts — Bootstrap Data Lake, seed CSVs, and optionally run dbt
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { initDataLake, getCatalog } from "../db/data-lake.js";

const ROOT = process.cwd();
const REQUIRED_CSVS = ["superstore_sales.csv", "retail_sales_dataset.csv"] as const;

function dbtAvailable(): boolean {
  try {
    execSync("dbt --version", { stdio: "ignore" });
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
    console.log("[Setup] Running dbt to create KPI views...");
    execSync("dbt run", { cwd: path.join(ROOT, "dbt"), stdio: "inherit" });
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

  initDataLake();
  const catalog = getCatalog();
  console.log(`[Setup] Data Lake ready — ${catalog.length} table(s) in catalog`);

  runDbtIfAvailable();
}

// Executed via: npm run setup
if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/setup/init.ts")) {
  ensureProjectReady().catch(console.error);
}
