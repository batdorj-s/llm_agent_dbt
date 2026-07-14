/**
 * data-quality.router.ts — Data Quality Dashboard API
 *
 * Reads dbt test results from run_results.json and manifests
 * to provide structured data quality metrics and drill-down.
 *
 * GET /api/data-quality/summary     → Pass/fail counts, execution stats
 * GET /api/data-quality/tests       → Per-test details with status
 * GET /api/data-quality/tests/:uid  → Single test detail + failing SQL
 */

import { Router } from "express";
import fs from "fs";
import path from "path";
import { requirePermission } from "../middleware/rbac.js";
import { log } from "./shared.js";

const router = Router();

const DBT_TARGET_DIR = path.join(process.cwd(), "dbt", "target");

interface DbtTestResult {
  unique_id: string;
  status: "pass" | "fail" | "error";
  failures: number;
  message?: string;
  compiled_code?: string;
  execution_time?: number;
  timing?: Array<{ name: string; started_at: string; completed_at: string }>;
  thread_id?: string;
}

interface DbtRunResults {
  results: DbtTestResult[];
  elapsed_time?: number;
  args?: Record<string, unknown>;
}

interface DbtTestNode {
  name: string;
  resource_type: string;
  test_metadata?: {
    name: string;
    kwargs: Record<string, string>;
    namespace?: string;
  };
  column_name?: string;
  depends_on?: { nodes?: string[] };
  description?: string;
  compiled_code?: string;
}

interface DbtManifest {
  nodes: Record<string, DbtTestNode>;
}

function loadRunResults(): DbtRunResults | null {
  const resultsPath = path.join(DBT_TARGET_DIR, "run_results.json");
  if (!fs.existsSync(resultsPath)) return null;
  try {
    const raw = fs.readFileSync(resultsPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadManifest(): DbtManifest | null {
  const manifestPath = path.join(DBT_TARGET_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function modelNameFromDependsOn(dependsOn: string[] | undefined): string | null {
  if (!dependsOn) return null;
  for (const dep of dependsOn) {
    if (dep.startsWith("model.")) {
      return dep.split(".").pop() || null;
    }
  }
  return null;
}

router.get("/data-quality/summary", requirePermission("quality:read"), (_req, res) => {
  try {
    const runResults = loadRunResults();
    if (!runResults) {
      res.json({ success: true, data: { available: false, message: "No dbt test results found. Run 'dbt test' first." } });
      return;
    }

    const results = runResults.results || [];
    const passed = results.filter((r) => r.status === "pass").length;
    const failed = results.filter((r) => r.status === "fail" || r.status === "error").length;
    const total = results.length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const totalTime = results.reduce((acc, r) => acc + (r.execution_time || 0), 0);

    res.json({
      success: true,
      data: {
        available: true,
        total,
        passed,
        failed,
        passRate,
        totalTimeSec: Math.round(totalTime * 10) / 10,
        elapsedTime: runResults.elapsed_time,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    log("error", "Data quality summary failed", {} as any, { error: (err as Error).message });
    res.status(500).json({ success: false, error: "Failed to load data quality summary" });
  }
});

router.get("/data-quality/tests", requirePermission("quality:read"), (req, res) => {
  try {
    const runResults = loadRunResults();
    const manifest = loadManifest();

    if (!runResults) {
      res.json({ success: true, data: [] });
      return;
    }

    const testNodes = manifest
      ? Object.values(manifest.nodes).filter(
          (n): n is DbtTestNode => n.resource_type === "test"
        )
      : [];

    const results = runResults.results.map((result) => {
      const testNode = testNodes.find((n) => result.unique_id.includes(n.name));
      const modelName = testNode ? modelNameFromDependsOn(testNode.depends_on?.nodes) : null;

      return {
        unique_id: result.unique_id,
        status: result.status,
        failures: result.failures,
        message: result.message || null,
        execution_time: result.execution_time || 0,
        test_name: testNode?.name || result.unique_id.split(".").pop() || "unknown",
        test_type: testNode?.test_metadata?.name || "test",
        column_name: testNode?.column_name || null,
        model_name: modelName,
        expression: testNode?.test_metadata?.kwargs?.expression || null,
      };
    });

    const { status } = req.query;
    let filtered = results;
    if (status && typeof status === "string") {
      filtered = results.filter((r) => r.status === status);
    }

    res.json({
      success: true,
      data: filtered,
      meta: { total: results.length, filtered: filtered.length },
    });
  } catch (err) {
    log("error", "Data quality tests failed", {} as any, { error: (err as Error).message });
    res.status(500).json({ success: false, error: "Failed to load test results" });
  }
});

export default router;
