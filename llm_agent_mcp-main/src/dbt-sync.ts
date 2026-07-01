import fs from "fs";
import path from "path";
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

interface DbtSourceNode {
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
