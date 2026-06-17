/**
 * agent-with-mcp.ts — Phase 1 (MCP) + Phase 2 (Agent) нэгтгэсэн хувилбар
 *
 * Энэ файл нь:
 *  1. MCP Server-тэй (index.ts) холбогддог
 *  2. MCP tools-г LangChain Tool болгон хувиргадаг
 *  3. LangGraph Agent нь эдгээр tool-г ашиглан бодит өгөгдөл татдаг
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

// ─────────────────────────────────────────────────────────────
// 1. MCP Client — MCP Server-тэй холбогдох
// ─────────────────────────────────────────────────────────────
async function createMCPClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
  });

  const client = new Client(
    { name: "agent-mcp-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("[MCP] Connected to Enterprise MCP Server ✅");
  return client;
}

// ─────────────────────────────────────────────────────────────
// 2. MCP Tools → LangChain Tools хөрвүүлэх
// ─────────────────────────────────────────────────────────────
function buildMCPTools(client: Client) {
  const getKpiTool = tool(
    async ({ metric }) => {
      console.log(`[MCP Tool] Calling get_kpi with metric="${metric}"`);
      const result = await client.callTool({
        name: "get_kpi",
        arguments: { metric },
      });
      const text = (result.content as Array<{ type: string; text: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      return text;
    },
    {
      name: "get_kpi",
      description:
        "Fetches the current value and target for a specific business KPI. Use for sales revenue, user counts, or churn rate questions.",
      schema: z.object({
        metric: z
          .enum(["sales", "users", "churn_rate"])
          .describe("The KPI metric to retrieve."),
      }),
    }
  );

  const getSalesHistoryTool = tool(
    async ({ limit }) => {
      console.log(`[MCP Tool] Calling get_sales_history with limit=${limit}`);
      const result = await client.callTool({
        name: "get_sales_history",
        arguments: { limit },
      });
      const text = (result.content as Array<{ type: string; text: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      return text;
    },
    {
      name: "get_sales_history",
      description:
        "Fetches the monthly sales revenue history. Use when the user asks about sales trends, monthly revenue, or historical sales data.",
      schema: z.object({
        limit: z
          .number()
          .min(1)
          .max(12)
          .optional()
          .describe("Number of months to retrieve. Default is 3."),
      }),
    }
  );

  const executeSqlTool = tool(
    async ({ query }) => {
      console.log(`[MCP Tool] Calling execute_sql with query: ${query}`);
      const result = await client.callTool({
        name: "execute_sql",
        arguments: { query },
      });
      const text = (result.content as Array<{ type: string; text: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      return text;
    },
    {
      name: "execute_sql",
      description:
        "Executes a SQLite SELECT query against the Data Lake and returns the results as JSON. Use for custom data analysis, aggregations, or filtering the superstore_sales table.",
      schema: z.object({
        query: z.string().describe("The SQLite SELECT query to execute."),
      }),
    }
  );

  const getCatalogTool = tool(
    async () => {
      console.log(`[MCP Tool] Calling get_data_lake_catalog`);
      const result = await client.callTool({
        name: "get_data_lake_catalog",
        arguments: {},
      });
      const text = (result.content as Array<{ type: string; text: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      return text;
    },
    {
      name: "get_data_lake_catalog",
      description:
        "Returns metadata about all tables in the Data Lake: table names, column names, and descriptions. Always call this first if you are unsure which tables or columns exist.",
      schema: z.object({}),
    }
  );

  return [getKpiTool, getSalesHistoryTool, executeSqlTool, getCatalogTool];
}

// ─────────────────────────────────────────────────────────────
// 3. LLM Selection
// ─────────────────────────────────────────────────────────────
function getLLM(tools: ReturnType<typeof buildMCPTools>) {
  if (
    process.env.ANTHROPIC_API_KEY &&
    process.env.ANTHROPIC_API_KEY !== "your_anthropic_api_key_here"
  ) {
    return new ChatAnthropic({
      model: "claude-3-5-sonnet-20240620",
      temperature: 0,
    }).bindTools(tools);
  }
  if (
    process.env.OPENAI_API_KEY &&
    process.env.OPENAI_API_KEY !== "your_openai_api_key_here"
  ) {
    return new ChatOpenAI({ model: "gpt-4o", temperature: 0 }).bindTools(tools);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 4. LangGraph Agent with MCP Tool Calling
// ─────────────────────────────────────────────────────────────
export async function runAgentWithMCP(query: string) {
  console.log("\n--- Agent with MCP Tools Starting ---");

  // Connect to MCP server
  let mcpClient: Client;
  try {
    mcpClient = await createMCPClient();
  } catch (err) {
    console.error("[MCP] Failed to connect to MCP Server:", err);
    console.warn("[MCP] Make sure the MCP server is startable with: npm start");
    return;
  }

  const mcpTools = buildMCPTools(mcpClient);
  const llm = getLLM(mcpTools);

  if (!llm) {
    console.warn(
      "⚠️  No LLM API key configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env"
    );
    await mcpClient.close();
    return;
  }

  // Agent node — calls LLM with tool binding
  async function agentNode(state: typeof MessagesAnnotation.State) {
    if (!llm) throw new Error("LLM is not initialized");
    const response = await llm.invoke(state.messages);
    return { messages: [response] };
  }

  // Decide whether to call tools or finish
  function shouldContinue(state: typeof MessagesAnnotation.State) {
    const last = state.messages[state.messages.length - 1] as any;
    return last.tool_calls?.length > 0 ? "tools" : "__end__";
  }

  const toolNode = new ToolNode(mcpTools);

  // Build the ReAct-style agent graph
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      __end__: "__end__",
    })
    .addEdge("tools", "agent"); // Loop back after tool call

  const app = workflow.compile();

  try {
    const result = await app.invoke({
      messages: [{ role: "user", content: query }],
    });

    const lastMsg = result.messages[result.messages.length - 1];
    console.log("\n--- Agent Response ---");
    console.log(lastMsg.content);
    return lastMsg.content;
  } finally {
    await mcpClient.close();
    console.log("[MCP] Client disconnected.");
  }
}

// ─────────────────────────────────────────────────────────────
// 5. Test runner (run directly: tsx src/agent-with-mcp.ts)
// ─────────────────────────────────────────────────────────────
async function main() {
  const testQueries = [
    "What is the current sales KPI and how does it compare to the target?",
    "Show me the sales history for the last 2 months.",
    "What is the current churn rate and is it within the acceptable range?",
  ];

  for (const query of testQueries) {
    console.log(`\n\nQuery: "${query}"`);
    await runAgentWithMCP(query);
  }
}

main().catch(console.error);
