import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "../../dbt/models/marts/schema.yml");

export async function generateSchemaYml(tableName: string, columns: string[]): Promise<void> {
  const colLower = columns.map(c => c.toLowerCase());

  const stgColumns = columns.map(name => {
    const low = name.toLowerCase();
    const tests: Array<string | Record<string, unknown>> = [];
    if (low === "order_id" || low === "customer_id") {
      tests.push("unique");
    }
    if (low === "order_id" || low === "customer_id" || low === "order_date") {
      tests.push("not_null");
    }
    const entry: Record<string, unknown> = {
      name,
      description: `Column from ${tableName}.${name}.`,
    };
    if (tests.length > 0) entry.tests = tests;
    return entry;
  });

  const schema = {
    version: 2,
    models: [
      {
        name: "stg_sales",
        description: `Cleaned sales data sourced from ${tableName}.`,
        columns: stgColumns,
      },
      {
        name: "int_sales_enriched",
        description: "Intermediate model with calculated metrics like profit margin.",
        columns: [
          { name: "order_id", tests: ["unique", "not_null"] },
        ],
      },
      {
        name: "kpi_sales",
        description: "Daily aggregated sales and profit metrics by category.",
        tests: [
          { "dbt_utils.equal_rowcount": { compare_model: "ref('stg_sales')" } },
        ],
      },
      {
        name: "user_metrics",
        description: "Customer-level metrics.",
        columns: [
          { name: "customer_id", tests: ["unique", "not_null"] },
        ],
      },
    ],
  };

  const yaml = await import("yaml");
  const content = yaml.stringify(schema, { indent: 2, lineWidth: -1 });
  fs.writeFileSync(SCHEMA_PATH, content, "utf8");
  console.log(`[dbt] schema.yml regenerated for '${tableName}' ✅`);
}
