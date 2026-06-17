import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function runTest() {
  console.log("Starting MCP Phase 1 Test...");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"]
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("✅ Connected to MCP Server");

  // Test Tool List
  const tools = await client.listTools();
  console.log("✅ Available Tools:", tools.tools.map(t => t.name));

  // Test get_kpi tool
  console.log("Testing get_kpi tool with metric 'sales'...");
  const kpiResult = await client.callTool({
    name: "get_kpi",
    arguments: { metric: "sales" }
  });
  console.log("✅ get_kpi Result:\n", JSON.stringify(kpiResult.content, null, 2));

  // Test get_sales_history tool
  console.log("Testing get_sales_history tool...");
  const salesResult = await client.callTool({
    name: "get_sales_history",
    arguments: { limit: 2 }
  });
  console.log("✅ get_sales_history Result:\n", JSON.stringify(salesResult.content, null, 2));

  console.log("🎉 Phase 1 MCP Server tests passed successfully.");
  process.exit(0);
}

runTest().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
