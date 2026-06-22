import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  handleGetKpi,
  handleGetSalesHistory,
  handleGetCatalog,
  handleExecuteSql,
} from "./tools/enterprise-tools.js";

const server = new McpServer({
  name: "enterprise-data-server",
  version: "1.0.0",
});

server.tool(
  "get_kpi",
  "Fetches the current value and target for a specific business KPI. Available metrics: sales, users, churn_rate.",
  {
    metric: z.enum(["sales", "users", "churn_rate"]).describe("The name of the KPI metric to retrieve."),
  },
  async ({ metric }) => {
    const result = await handleGetKpi({ metric });
    return { content: [{ type: "text", text: result.text }] };
  }
);

server.tool(
  "get_sales_history",
  "Fetches the sales revenue history for recent months (Read-Only SELECT equivalent).",
  {
    limit: z.number().min(1).max(12).optional().describe("Number of months to retrieve. Default is 3."),
  },
  async ({ limit = 3 }) => {
    const result = await handleGetSalesHistory({ limit });
    return { content: [{ type: "text", text: result.text }] };
  }
);

// SECURITY: userId from env, NOT per-request authenticated. Assumes stdio transport
// where 1 process = 1 user (inherent isolation). Before adding SSE/WebSocket transport,
// per-request userId authentication MUST be implemented — otherwise every client shares
// the same identity.
const MCP_USER_ID = process.env.MCP_USER_ID || "system";

server.tool(
  "get_data_lake_catalog",
  "Fetches the Data Lake catalog, showing all available tables, who created them, when, and their columns.",
  {},
  async () => {
    const result = await handleGetCatalog({ userId: MCP_USER_ID });
    return { content: [{ type: "text", text: result.text }] };
  }
);

server.tool(
  "execute_sql",
  "Executes a SQL query on the Data Lake database and returns the results. Supports standard SQLite features, including CTEs (WITH).",
  {
    query: z.string().describe("The SQL query to execute."),
  },
  async ({ query }) => {
    const result = await handleExecuteSql({ query, userId: MCP_USER_ID });
    return { content: [{ type: "text", text: result.text }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Enterprise MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
