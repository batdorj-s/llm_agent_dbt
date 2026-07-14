/**
 * glossary.router.ts — Unified Data Dictionary & Business Glossary API
 *
 * Sources:
 *   docs/knowledge-base.yaml     — Business Glossary (25+ documents)
 *   src/rag/finance-glossary.yaml — Finance-specific terms (40+ terms)
 *   docs/dbt-metrics.yaml         — dbt metrics layer definitions
 *
 * GET /api/glossary          → All entries flattened with source tag
 * GET /api/glossary?search=  → Search by term name / keyword / text
 * GET /api/glossary?category= → Filter by category
 * GET /api/glossary?department= → Filter by department
 */

import { Router } from "express";
import fs from "fs";
import path from "path";
import yaml from "yaml";
import { requirePermission } from "../middleware/rbac.js";
import { log } from "./shared.js";

const router = Router();

const DOCS_DIR = path.join(process.cwd(), "docs");
const RAG_DIR = path.join(process.cwd(), "src", "rag");
const GLOSSARY_YAML = path.join(DOCS_DIR, "knowledge-base.yaml");
const FINANCE_GLOSSARY_YAML = path.join(RAG_DIR, "finance-glossary.yaml");
const METRICS_YAML = path.join(DOCS_DIR, "dbt-metrics.yaml");

interface GlossaryEntry {
  id: string;
  term: string;
  definition: string;
  category: string;
  department?: string;
  source: string;
  keywords: string[];
  synonyms?: string[];
  column_mappings?: Array<{ column: string; tables: string[] }>;
  calculation_method?: string;
  expression?: string;
}

function loadKnowledgeBaseEntries(): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  if (!fs.existsSync(GLOSSARY_YAML)) return entries;
  try {
    const raw = fs.readFileSync(GLOSSARY_YAML, "utf-8");
    const parsed = yaml.parse(raw);
    if (!parsed?.documents) return entries;
    for (const doc of parsed.documents) {
      const id = doc.id || "";
      const text = doc.text || "";
      const meta = doc.metadata || {};
      const title = text.split("\n")[0]?.replace(/^[#\s]+/, "").split(":")[0]?.trim() || id;
      entries.push({
        id,
        term: title,
        definition: text,
        category: meta.category || "uncategorized",
        department: meta.department,
        source: meta.source_name || "Business Glossary",
        keywords: doc.keywords || [],
      });
    }
  } catch (err) {
    log("error", "Failed to load knowledge-base.yaml", {} as any, { error: (err as Error).message });
  }
  return entries;
}

function loadFinanceGlossaryEntries(): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  if (!fs.existsSync(FINANCE_GLOSSARY_YAML)) return entries;
  try {
    const raw = fs.readFileSync(FINANCE_GLOSSARY_YAML, "utf-8");
    const parsed = yaml.parse(raw);
    if (!parsed?.terms) return entries;
    for (const term of parsed.terms) {
      entries.push({
        id: `finance_${term.term}`,
        term: term.term,
        definition: term.definition?.trim() || "",
        category: term.subcategory || term.category || "finance",
        department: "finance",
        source: "Finance Glossary",
        keywords: term.tags || [],
      });
    }
  } catch (err) {
    log("error", "Failed to load finance-glossary.yaml", {} as any, { error: (err as Error).message });
  }
  return entries;
}

function loadMetricEntries(): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  if (!fs.existsSync(METRICS_YAML)) return entries;
  try {
    const raw = fs.readFileSync(METRICS_YAML, "utf-8");
    const parsed = yaml.parse(raw);
    if (!parsed?.metrics) return entries;
    for (const m of parsed.metrics) {
      entries.push({
        id: `metric_${m.name}`,
        term: m.label || m.name,
        definition: m.description || "",
        category: "metric",
        department: "analytics",
        source: "dbt Metrics Layer",
        keywords: [m.name, ...(m.synonyms || []), m.label].filter(Boolean),
        synonyms: m.synonyms,
        column_mappings: m.column_mappings,
        calculation_method: m.calculation_method,
        expression: m.expression,
      });
    }
  } catch (err) {
    log("error", "Failed to load dbt-metrics.yaml", {} as any, { error: (err as Error).message });
  }
  return entries;
}

function getAllEntries(): GlossaryEntry[] {
  return [
    ...loadKnowledgeBaseEntries(),
    ...loadFinanceGlossaryEntries(),
    ...loadMetricEntries(),
  ];
}

router.get("/glossary", requirePermission("glossary:read"), (req, res) => {
  try {
    const { search, category, department } = req.query;
    let entries = getAllEntries();

    if (search && typeof search === "string") {
      const q = search.toLowerCase();
      entries = entries.filter((e) =>
        e.term.toLowerCase().includes(q) ||
        e.definition.toLowerCase().includes(q) ||
        e.keywords.some((k) => k.toLowerCase().includes(q)) ||
        e.synonyms?.some((s) => s.toLowerCase().includes(q))
      );
    }

    if (category && typeof category === "string") {
      entries = entries.filter((e) => e.category === category);
    }

    if (department && typeof department === "string") {
      entries = entries.filter((e) => e.department === department);
    }

    const categories = [...new Set(getAllEntries().map((e) => e.category))].sort();
    const departments = [...new Set(getAllEntries().map((e) => e.department).filter(Boolean))].sort();

    res.json({
      success: true,
      data: entries,
      meta: { total: entries.length, categories, departments },
    });
  } catch (err) {
    log("error", "Glossary route failed", req as any, { error: (err as Error).message });
    res.status(500).json({ success: false, error: "Failed to load glossary" });
  }
});

export default router;
