import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getRepository } from "./db/kpi-repository.js";
import { getCatalog, executeSql } from "./db/data-lake.js";

// Create a new MCP server
const server = new McpServer({
  name: "enterprise-data-server",
  version: "1.0.0",
});

// ─────────────────────────────────────────────────────────────
// Tool: get_kpi — Fetches a business KPI from the repository
// ─────────────────────────────────────────────────────────────
server.tool(
  "get_kpi",
  "Fetches the current value and target for a specific business KPI. Available metrics: sales, users, churn_rate.",
  {
    metric: z.enum(["sales", "users", "churn_rate"]).describe("The name of the KPI metric to retrieve."),
  },
  async ({ metric }) => {
    const repo = await getRepository();
    const data = await repo.getKpi(metric);

    if (!data) {
      return {
        content: [{ type: "text", text: `Error: Metric '${metric}' not found.` }],
      };
    }

    const pct = ((data.current / data.target) * 100).toFixed(1);
    const status = data.current >= data.target ? "✅ On target" : "⚠️ Below target";

    const resultText = [
      `KPI Metric: ${metric.toUpperCase()}`,
      `Current:    ${data.current} ${data.unit}`,
      `Target:     ${data.target} ${data.unit}`,
      `Progress:   ${pct}% — ${status}`,
      ...(data.updatedAt ? [`Updated:    ${new Date(data.updatedAt).toLocaleString()}`] : []),
    ].join("\n");

    return { content: [{ type: "text", text: resultText }] };
  }
);

// ─────────────────────────────────────────────────────────────
// Tool: get_sales_history — Fetches monthly revenue history
// ─────────────────────────────────────────────────────────────
server.tool(
  "get_sales_history",
  "Fetches the sales revenue history for recent months (Read-Only SELECT equivalent).",
  {
    limit: z.number().min(1).max(12).optional().describe("Number of months to retrieve. Default is 3."),
  },
  async ({ limit = 3 }) => {
    const repo = await getRepository();
    const records = await repo.getSalesHistory(limit);

    if (records.length === 0) {
      return { content: [{ type: "text", text: "No sales history available." }] };
    }

    const total = records.reduce((sum, r) => sum + r.revenue, 0);
    const avg   = (total / records.length).toFixed(0);

    const lines = records.map(r => `  ${r.month}: $${r.revenue.toLocaleString()}`);
    const resultText = [
      `Sales History (last ${records.length} months):`,
      ...lines,
      `─────────────────────────`,
      `  Total:   $${total.toLocaleString()}`,
      `  Average: $${Number(avg).toLocaleString()} / month`,
    ].join("\n");

    return { content: [{ type: "text", text: resultText }] };
  }
);

// ─────────────────────────────────────────────────────────────
// Tool: get_data_lake_catalog — Returns information about all tables
// ─────────────────────────────────────────────────────────────
server.tool(
  "get_data_lake_catalog",
  "Fetches the Data Lake catalog, showing all available tables, who created them, when, and their columns.",
  {},
  async () => {
    try {
      const catalog = getCatalog();
      if (!catalog || catalog.length === 0) {
        return { content: [{ type: "text", text: "Data Lake catalog is empty." }] };
      }
      
      const lines = catalog.map((row: any) => 
        `Table: ${row.table_name}\nCreated By: ${row.created_by}\nCreated At: ${row.created_at}\nColumns: ${row.columns_info}\nDescription: ${row.description}\n`
      );
      
      return { content: [{ type: "text", text: `Data Lake Catalog:\n\n${lines.join("\n---\n")}` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error fetching catalog: ${err.message}` }] };
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Tool: execute_sql — Executes a SQL query (including CTEs)
// ─────────────────────────────────────────────────────────────
server.tool(
  "execute_sql",
  "Executes a SQL query on the Data Lake database and returns the results. Supports standard SQLite features, including CTEs (WITH).",
  {
    query: z.string().describe("The SQL query to execute."),
  },
  async ({ query }) => {
    // SELECT-only guard: reject any mutating statement
    const normalized = query.trimStart().toUpperCase();
    const dangerousKeywords = ["DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "CREATE", "REPLACE", "TRUNCATE"];
    const isDangerous = dangerousKeywords.some(kw => normalized.startsWith(kw));
    if (isDangerous) {
      return {
        content: [{ type: "text", text: "Error: Only SELECT queries are permitted. Mutating operations (DROP, DELETE, UPDATE, INSERT, etc.) are not allowed." }],
      };
    }

    try {
      console.log(`[MCP Server] Executing SQL: ${query}`);
      const results = executeSql(query);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `SQL Execution Error: ${err.message}` }] };
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Enterprise MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
