import { Router } from "express";
import fs from "fs";
import path from "path";
import yaml from "yaml";
import { getPool } from "../db/pool.js";
import { requirePermission } from "../middleware/rbac.js";
import { log } from "./shared.js";

const router = Router();

interface SearchResult {
  type: "catalog" | "glossary" | "lineage" | "quality";
  title: string;
  description: string;
  matchField: string;
  matchValue: string;
  score: number;
  meta?: Record<string, any>;
}

const GLOSSARY_SOURCES = [
  path.resolve("docs/knowledge-base.yaml"),
  path.resolve("src/rag/finance-glossary.yaml"),
  path.resolve("docs/dbt-metrics.yaml"),
];

function loadGlossaryTerms(): Array<{ title: string; description: string; category: string; keywords: string[] }> {
  const terms: Array<{ title: string; description: string; category: string; keywords: string[] }> = [];
  for (const filePath of GLOSSARY_SOURCES) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = yaml.parse(raw);
      const docs = parsed?.documents || parsed || [];
      for (const doc of Array.isArray(docs) ? docs : [docs]) {
        if (doc.title || doc.name || doc.metric_name) {
          terms.push({
            title: doc.title || doc.name || doc.metric_name || "",
            description: doc.description || doc.definition || "",
            category: doc.category || doc.type || "general",
            keywords: doc.synonyms || doc.tags || [],
          });
        }
      }
    } catch { /* skip unparseable */ }
  }
  return terms;
}

router.get("/search", requirePermission("dashboard:read"), async (req, res) => {
  try {
    const q = ((req.query.q as string) || "").trim().toLowerCase();
    if (!q) {
      res.json({ success: true, data: [] });
      return;
    }

    const results: SearchResult[] = [];
    const pool = getPool();
    const userId = (req as any).user?.userId || "user-admin-001";

    // ── 1. Catalog search ──
    try {
      const catResult = await pool.query(
        `SELECT table_name, description, columns_info
         FROM data_lake_catalog
         WHERE (visibility = 'shared' OR owner_id = $1)
           AND (LOWER(table_name) LIKE $2 OR LOWER(COALESCE(description, '')) LIKE $2)
         LIMIT 10`,
        [userId, `%${q}%`]
      );
      for (const row of catResult.rows) {
        results.push({
          type: "catalog",
          title: row.table_name,
          description: row.description || "",
          matchField: row.table_name.toLowerCase().includes(q) ? "table_name" : "description",
          matchValue: q,
          score: row.table_name.toLowerCase() === q ? 100 : row.table_name.toLowerCase().includes(q) ? 80 : 50,
        });
      }
    } catch { /* ignore catalog errors */ }

    // ── 2. Glossary search ──
    const terms = loadGlossaryTerms();
    for (const term of terms) {
      const titleMatch = term.title.toLowerCase().includes(q);
      const descMatch = term.description.toLowerCase().includes(q);
      const keywordMatch = term.keywords.some((k) => k.toLowerCase().includes(q));

      if (titleMatch || descMatch || keywordMatch) {
        results.push({
          type: "glossary",
          title: term.title,
          description: term.description.slice(0, 200),
          matchField: titleMatch ? "title" : keywordMatch ? "keyword" : "description",
          matchValue: q,
          score: titleMatch ? 90 : keywordMatch ? 70 : 40,
          meta: { category: term.category },
        });
      }
    }

    // ── 3. Lineage search (model names) ──
    const graphPath = path.resolve("dbt", "target", "graph_summary.json");
    if (fs.existsSync(graphPath)) {
      try {
        const graph = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
        const nodes = graph.nodes || graph.models || [];
        for (const node of Array.isArray(nodes) ? nodes : Object.values(nodes)) {
          const name = node.name || node.id || "";
          const desc = node.description || "";
          if (name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)) {
            results.push({
              type: "lineage",
              title: name,
              description: desc,
              matchField: name.toLowerCase().includes(q) ? "name" : "description",
              matchValue: q,
              score: name.toLowerCase() === q ? 95 : name.toLowerCase().includes(q) ? 75 : 40,
              meta: { modelType: node.resource_type || node.type || "model" },
            });
          }
        }
      } catch { /* skip */ }
    }

    // ── 4. Quality test search ──
    const manifestPath = path.resolve("dbt", "target", "manifest.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        const testNodes = Object.values(manifest.nodes || {}).filter((n: any) => n.resource_type === "test");

        for (const node of testNodes as any[]) {
          const name = node.name || "";
          const desc = node.description || "";
          if (name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)) {
            results.push({
              type: "quality",
              title: name,
              description: desc || node.test_metadata?.name || "",
              matchField: name.toLowerCase().includes(q) ? "test_name" : "description",
              matchValue: q,
              score: name.toLowerCase() === q ? 85 : name.toLowerCase().includes(q) ? 65 : 35,
              meta: {
                column: node.column_name || null,
                model: node.depends_on?.nodes?.find((d: string) => d.startsWith("model."))?.split(".").pop() || null,
              },
            });
          }
        }
      } catch { /* skip */ }
    }

    // Also search custom data quality tests
    try {
      const customResult = await pool.query(
        `SELECT name, description, model_name, test_type FROM data_quality_tests
         WHERE is_active = true AND (LOWER(name) LIKE $1 OR LOWER(COALESCE(description, '')) LIKE $1)
         LIMIT 10`,
        [`%${q}%`]
      );
      for (const row of customResult.rows) {
        results.push({
          type: "quality",
          title: row.name,
          description: row.description || "",
          matchField: "custom_test",
          matchValue: q,
          score: 60,
          meta: { model: row.model_name, testType: row.test_type },
        });
      }
    } catch { /* skip */ }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    res.json({
      success: true,
      data: results.slice(0, 50),
      meta: { query: q, total: results.length },
    });
  } catch (err) {
    log("error", "Unified search failed", req as any, { error: (err as Error).message });
    res.status(500).json({ success: false, error: "Search failed" });
  }
});

export default router;
