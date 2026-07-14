import fs from "fs";
import path from "path";
import yaml from "yaml";
import type { RagDocument } from "./rag.js";

const DBT_TARGET_DIR = path.join(process.cwd(), "dbt", "target");

interface DbtManifest {
  nodes: Record<string, DbtModelNode>;
  sources?: Record<string, any>;
}

interface DbtModelNode {
  name: string;
  resource_type: string;
  description?: string;
  database?: string;
  schema?: string;
  config?: { materialized?: string };
  columns?: Record<string, { name: string; description?: string; data_type?: string }>;
  tests?: Array<{ name?: string; severity?: string; expression?: string }>;
}

interface _DbtSourceNode {
  name: string;
  description?: string;
  database?: string;
  schema?: string;
  source_name: string;
  columns?: Record<string, { name: string; description?: string; data_type?: string }>;
}

function loadManifest(): DbtManifest | null {
  const manifestPath = path.join(DBT_TARGET_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.warn("[dbt-sync] manifest.json not found — run 'dbt docs generate' first");
    return null;
  }
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[dbt-sync] Failed to parse manifest.json:", (err as Error).message);
    return null;
  }
}

export function syncDbtModelsToRag(): RagDocument[] {
  const docs: RagDocument[] = [];
  const manifest = loadManifest();
  if (!manifest) return docs;

  const modelNodes = Object.values(manifest.nodes).filter(
    (n): n is DbtModelNode => n.resource_type === "model"
  );

  for (const model of modelNodes) {
    const modelDesc = model.description || "No description available.";
    const mat = model.config?.materialized || "view";

    docs.push({
      id: `dbt_model_${model.name}`,
      text: `dbt Model: ${model.name}\nMaterialization: ${mat}\nDescription: ${modelDesc}\nTable: ${model.database || ""}.${model.schema || "public"}.${model.name}`,
      metadata: {
        category: "data_catalog",
        department: "analytics",
        source_name: "dbt Manifest",
        author: "dbt",
        created_at: new Date().toISOString(),
        shared: true,
      },
      keywords: ["dbt", "model", model.name, mat, ...modelDesc.toLowerCase().split(/\W+/).filter(Boolean)],
    });

    if (model.columns) {
      for (const [colName, col] of Object.entries(model.columns)) {
        const colDesc = col.description || "No description.";
        docs.push({
          id: `dbt_col_${model.name}_${colName}`,
          text: `dbt Column: ${model.name}.${colName}\nData Type: ${col.data_type || "unknown"}\nDescription: ${colDesc}\nModel: ${model.name}`,
          metadata: {
            category: "data_catalog",
            department: "analytics",
            source_name: "dbt Manifest",
            author: "dbt",
            created_at: new Date().toISOString(),
            shared: true,
          },
          keywords: ["dbt", "column", model.name, colName, ...colDesc.toLowerCase().split(/\W+/).filter(Boolean)],
        });
      }
    }

    if (model.tests && model.tests.length > 0) {
      const testDescriptions = model.tests.map((t) => {
        if (t.expression) return `${t.name || "assert_true"}: ${t.expression} (severity: ${t.severity || "error"})`;
        return `${t.name || "test"} (severity: ${t.severity || "error"})`;
      }).join("\n");

      docs.push({
        id: `dbt_tests_${model.name}`,
        text: `dbt Tests for Model: ${model.name}\n${testDescriptions}`,
        metadata: {
          category: "data_catalog",
          department: "analytics",
          source_name: "dbt Manifest",
          author: "dbt",
          created_at: new Date().toISOString(),
          shared: true,
        },
        keywords: ["dbt", "test", model.name, "data quality", "assertion"],
      });
    }
  }

  const sourceNodes = manifest.sources
    ? Object.values(manifest.sources).flatMap((source: any) =>
        (source.tables || []).map((table: any) => ({
          ...table,
          source_name: source.name,
        }))
      )
    : [];

  for (const src of sourceNodes) {
    const srcDesc = src.description || `Raw data from source ${src.source_name}.`;
    docs.push({
      id: `dbt_source_${src.name}`,
      text: `dbt Source: ${src.source_name}.${src.name}\nDescription: ${srcDesc}\nSchema: ${src.schema || "public"}`,
      metadata: {
        category: "data_catalog",
        department: "analytics",
        source_name: "dbt Manifest",
        author: "dbt",
        created_at: new Date().toISOString(),
        shared: true,
      },
      keywords: ["dbt", "source", src.source_name, src.name, ...srcDesc.toLowerCase().split(/\W+/).filter(Boolean)],
    });

    if (src.columns) {
      for (const [colName, col] of Object.entries<{ name: string; description?: string; data_type?: string }>(src.columns)) {
        const colDesc = col.description || "No description.";
        docs.push({
          id: `dbt_source_col_${src.name}_${colName}`,
          text: `dbt Source Column: ${src.source_name}.${src.name}.${colName}\nData Type: ${col.data_type || "unknown"}\nDescription: ${colDesc}`,
          metadata: {
            category: "data_catalog",
            department: "analytics",
            source_name: "dbt Manifest",
            author: "dbt",
            created_at: new Date().toISOString(),
            shared: true,
          },
          keywords: ["dbt", "source", "column", src.name, colName],
        });
      }
    }
  }

  console.log(`[dbt-sync] Generated ${docs.length} RAG documents from dbt manifest`);
  return docs;
}

interface DbtRunResult {
  results: Array<{
    unique_id: string;
    status: "pass" | "fail" | "error";
    failures: number;
    message?: string;
    compiled_code?: string;
    execution_time?: number;
  }>;
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

function loadRunResults(): DbtRunResult | null {
  const resultsPath = path.join(DBT_TARGET_DIR, "run_results.json");
  if (!fs.existsSync(resultsPath)) {
    console.warn("[dbt-sync] run_results.json not found — run 'dbt test' first");
    return null;
  }
  try {
    const raw = fs.readFileSync(resultsPath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[dbt-sync] Failed to parse run_results.json:", (err as Error).message);
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

export function syncDbtTestResultsToRag(): RagDocument[] {
  const docs: RagDocument[] = [];
  const manifest = loadManifest();
  const runResults = loadRunResults();

  if (!runResults) return docs;

  const testNodes = manifest
    ? (Object.values(manifest.nodes).filter(
        (n): n is DbtTestNode => n.resource_type === "test"
      ) as DbtTestNode[])
    : [];

  const testNodeMap = new Map<string, DbtTestNode>();
  for (const node of testNodes) {
    testNodeMap.set(`test.${node.name}`, node);
    testNodeMap.set(`test.data_transformations.${node.name}`, node);
  }

  let passed = 0;
  let failed = 0;

  for (const result of runResults.results) {
    const uid = result.unique_id;
    const status = result.status;

    if (status === "pass") {
      passed++;
      continue;
    }

    failed++;

    const testNode = testNodes.find((n) => uid.includes(n.name));
    const modelName = testNode
      ? modelNameFromDependsOn(testNode.depends_on?.nodes)
      : null;

    const testName = testNode?.name || uid.split(".").pop() || uid;
    const testType = testNode?.test_metadata?.name || "test";
    const expression = testNode?.test_metadata?.kwargs?.expression;
    const columnName = testNode?.column_name;

    const lines: string[] = [
      `[DBT WARNING] Data quality test failed: ${testName}`,
      `Test type: ${testType}`,
      modelName ? `Affected model: ${modelName}` : "",
      columnName ? `Column: ${columnName}` : "",
      expression ? `Expression: ${expression}` : "",
      result.message ? `Error: ${result.message}` : "",
      `Status: ${status} (${result.failures} failures)`,
    ].filter(Boolean);

    docs.push({
      id: `dbt_warning_${testName}`,
      text: lines.join("\n"),
      metadata: {
        category: "previous_analysis",
        department: "analytics",
        source_name: "dbt Test Results",
        author: "dbt",
        created_at: new Date().toISOString(),
        shared: true,
      },
      keywords: [
        "dbt_warning",
        "data quality",
        "test failure",
        testType,
        testName,
        ...(modelName ? [modelName] : []),
        ...(columnName ? [columnName] : []),
      ],
    });
  }

  docs.push({
    id: `dbt_test_summary`,
    text: `dbt Test Summary: ${passed + failed} total, ${passed} passed, ${failed} failed.`,
    metadata: {
      category: "previous_analysis",
      department: "analytics",
      source_name: "dbt Test Results",
      author: "dbt",
      created_at: new Date().toISOString(),
      shared: true,
    },
    keywords: ["dbt_warning", "data quality", "test summary", passed > 0 ? "tests_passed" : "", failed > 0 ? "tests_failed" : ""].filter(Boolean),
  });

  if (failed > 0) {
    console.log(`[dbt-sync] WARNING: ${failed}/${passed + failed} dbt tests FAILED — generated ${docs.length} RAG warning documents`);
  } else {
    console.log(`[dbt-sync] All ${passed} dbt tests passed — generated summary document`);
  }

  return docs;
}

const METRICS_YAML_PATH = path.join(process.cwd(), "docs", "dbt-metrics.yaml");

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

export function syncDbtMetricsToRag(): RagDocument[] {
  const docs: RagDocument[] = [];

  if (!fs.existsSync(METRICS_YAML_PATH)) {
    console.warn("[dbt-sync] metrics.yml not found — define business metrics first");
    return docs;
  }

  try {
    const raw = fs.readFileSync(METRICS_YAML_PATH, "utf-8");
    const parsed = yaml.parse(raw) as MetricsYaml;

    if (!parsed?.metrics || !Array.isArray(parsed.metrics)) {
      console.warn("[dbt-sync] No metrics defined in metrics.yml");
      return docs;
    }

    for (const metric of parsed.metrics) {
      const modelRef = metric.model ? metric.model.replace("ref('", "").replace("')", "") : "unknown";

      const lines = [
        `Metric: ${metric.name}`,
        metric.label ? `Label (MN): ${metric.label}` : "",
        metric.description ? `Description: ${metric.description}` : "",
        `Calculation: ${metric.calculation_method || "unknown"} of ${metric.expression || "N/A"}`,
        `Source Model: ${modelRef}`,
        metric.synonyms?.length ? `Business Keywords: ${metric.synonyms.join(", ")}` : "",
      ].filter(Boolean);

      const text = lines.join("\n");

      const keywords = [
        "dbt_metric",
        metric.name,
        ...(metric.synonyms || []),
        ...(metric.label ? [metric.label] : []),
        modelRef,
      ];

      docs.push({
        id: `dbt_metric_${metric.name}`,
        text,
        metadata: {
          category: "business_policy",
          department: "analytics",
          source_name: "dbt Metrics Layer",
          author: "dbt",
          created_at: new Date().toISOString(),
          shared: true,
        },
        keywords,
      });
    }

    console.log(`[dbt-sync] Generated ${docs.length} RAG documents from dbt metrics layer`);
  } catch (err) {
    console.warn("[dbt-sync] Failed to load metrics.yml:", (err as Error).message);
  }

  return docs;
}
