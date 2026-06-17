import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { createLLM, printProviderStatus } from "./llm-provider.js";
import { searchKnowledgeBase } from "./rag.js";
import dotenv from "dotenv";

dotenv.config();

// Define the Agent logic using LangGraph
async function agentNode(state: typeof MessagesAnnotation.State) {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];

  console.log(`[Agent] Processing query: "${lastMessage.content}"`);

  // Step 1: Context Retrieval (RAG)
  console.log("[Agent] Searching Knowledge Base...");
  const searchResults = await searchKnowledgeBase(lastMessage.content as string);

  let context = "";
  if (searchResults && searchResults.documents[0].length > 0) {
      context = searchResults.documents[0].join("\n");
      console.log(`[Agent] Found context: ${context}`);
  } else {
      console.log("[Agent] No specific context found in DB.");
  }

  // Step 2: LLM Generation — auto-select from available providers
  const llm = await createLLM({ temperature: 0 });

  if (!llm) {
      console.warn("⚠️ No LLM API Key found. Add GOOGLE_API_KEY or GROQ_API_KEY to .env (both free!)");
      return {
          messages: [{
              role: "assistant",
              content: `(Mock LLM Response)\nI found this in the knowledge base:\n${context}\n\nTo fetch real-time data, I would normally use MCP tools here.`
          }]
      };
  }

  // Step 3: Call LLM with RAG context
  const systemPrompt = `You are an Enterprise AI Agent. Use the following knowledge base context to answer questions.\n\nContext:\n${context}`;

  const response = await llm.invoke([
      { role: "system", content: systemPrompt },
      ...messages
  ]);

  return { messages: [response] };
}

// Build the LangGraph Workflow
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", agentNode)
  .addEdge("__start__", "agent")
  .addEdge("agent", "__end__");

export const agentApp = workflow.compile();

// Helper to run the agent
export async function runAgent(query: string) {
    console.log("--- Starting Agent Execution ---");
    const result = await agentApp.invoke({
        messages: [{ role: "user", content: query }]
    });
    console.log("--- Final Response ---");
    console.log(result.messages[result.messages.length - 1].content);
}
