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

// ── Custom Data Quality Test CRUD ──────────────────────────

import crypto from "crypto";
import { getPool } from "../db/pool.js";

router.get("/data-quality/custom-tests", requirePermission("quality:read"), async (_req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      "SELECT * FROM data_quality_tests ORDER BY updated_at DESC"
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to load custom tests" });
  }
});

router.post("/data-quality/custom-tests", requirePermission("quality:create"), async (req, res) => {
  try {
    const { name, model_name, column_name, test_type, expression, severity, description } = req.body;
    if (!name || !model_name) {
      res.status(400).json({ error: "name and model_name are required" });
      return;
    }
    const id = `dqt_${crypto.randomBytes(6).toString("hex")}`;
    const userId = (req as any).user?.userId || "system";
    const pool = getPool();

    await pool.query(
      `INSERT INTO data_quality_tests (id, name, model_name, column_name, test_type, expression, severity, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, name, model_name, column_name || null, test_type || "assert_true", expression || null, severity || "error", description || "", userId]
    );

    res.status(201).json({ success: true, data: { id, name, model_name } });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to create test" });
  }
});

router.put("/data-quality/custom-tests/:id", requirePermission("quality:write"), async (req, res) => {
  try {
    const { name, model_name, column_name, test_type, expression, severity, description, is_active } = req.body;
    const pool = getPool();

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx++}`); params.push(name); }
    if (model_name !== undefined) { sets.push(`model_name = $${idx++}`); params.push(model_name); }
    if (column_name !== undefined) { sets.push(`column_name = $${idx++}`); params.push(column_name); }
    if (test_type !== undefined) { sets.push(`test_type = $${idx++}`); params.push(test_type); }
    if (expression !== undefined) { sets.push(`expression = $${idx++}`); params.push(expression); }
    if (severity !== undefined) { sets.push(`severity = $${idx++}`); params.push(severity); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); params.push(description); }
    if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(is_active); }

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);

    if (sets.length === 1) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    await pool.query(`UPDATE data_quality_tests SET ${sets.join(", ")} WHERE id = $${idx}`, params);
    res.json({ success: true, message: "Test updated" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to update test" });
  }
});

router.delete("/data-quality/custom-tests/:id", requirePermission("quality:write"), async (req, res) => {
  try {
    const pool = getPool();
    await pool.query("DELETE FROM data_quality_tests WHERE id = $1", [req.params.id]);
    res.json({ success: true, message: "Test deleted" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to delete test" });
  }
});

export default router;
