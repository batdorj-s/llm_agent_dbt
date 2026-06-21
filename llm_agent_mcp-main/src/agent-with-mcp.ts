/**
 * agent-with-mcp.ts — MCP tools + LangGraph ReAct agent
 *
 * Uses in-process LangChain tools (same logic as MCP server) with llm-provider auto-select.
 * Stdio MCP server (index.ts) remains available for external MCP clients and tests.
 */

import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { createLLM } from "./llm-provider.js";
import { buildEnterpriseLangChainTools } from "./tools/langchain-tools.js";
import dotenv from "dotenv";

dotenv.config();

export async function runAgentWithMCP(query: string, userId: string = "system") {
  console.log("\n--- Agent with MCP Tools Starting ---");

  const mcpTools = buildEnterpriseLangChainTools(userId);
  const llm = await createLLM({ temperature: 0 });

  if (!llm) {
    console.warn("[WARN]  No LLM API key configured. Add GOOGLE_API_KEY or GROQ_API_KEY to .env");
    return;
  }

  const boundLlm = llm.bindTools(mcpTools);

  async function agentNode(state: typeof MessagesAnnotation.State) {
    const response = await boundLlm.invoke(state.messages);
    return { messages: [response] };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State) {
    const last = state.messages[state.messages.length - 1] as { tool_calls?: unknown[] };
    return last.tool_calls?.length ? "tools" : "__end__";
  }

  const toolNode = new ToolNode(mcpTools);

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      __end__: "__end__",
    })
    .addEdge("tools", "agent");

  const app = workflow.compile();

  const result = await app.invoke({
    messages: [{ role: "user", content: query }],
  });

  const lastMsg = result.messages[result.messages.length - 1];
  console.log("\n--- Agent Response ---");
  console.log(lastMsg.content);
  return lastMsg.content;
}

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
