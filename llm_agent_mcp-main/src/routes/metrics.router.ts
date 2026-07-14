import { Router } from "express";
import { requireAuth } from "../auth.js";
import { requirePermission } from "../middleware/rbac.js";
import fs from "fs";
import path from "path";
import yaml from "yaml";

const router = Router();

interface DbtMetric {
  name: string;
  label?: string;
  description?: string;
  model?: string;
  calculation_method?: string;
  expression?: string;
  synonyms?: string[];
  column_mappings?: Array<{ column: string; tables: string[] }>;
}

interface MetricsYaml {
  metrics?: DbtMetric[];
}

function loadMetrics(): DbtMetric[] {
  const metricsPath = path.join(process.cwd(), "docs", "dbt-metrics.yaml");
  if (!fs.existsSync(metricsPath)) return [];
  try {
    const raw = fs.readFileSync(metricsPath, "utf-8");
    const parsed = yaml.parse(raw) as MetricsYaml;
    return parsed?.metrics || [];
  } catch {
    return [];
  }
}

/**
 * GET /api/metrics — return all defined business metrics
 */
router.get("/", requireAuth, requirePermission("metrics:read"), async (_req, res) => {
  try {
    const metrics = loadMetrics();
    res.json({ success: true, data: metrics, count: metrics.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
