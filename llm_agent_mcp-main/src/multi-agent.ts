import { StateGraph, MemorySaver } from "@langchain/langgraph";
import { dataScientistNode } from "./agents/data-scientist.js";
import { financeAgentNode } from "./agents/financeAgentNode.js";
import { techAgentNode } from "./agents/techAgentNode.js";
import { supervisorNode } from "./agents/supervisorNode.js";
import { verifyToken } from "./auth.js";
import { initTracing } from "./observability/tracer.js";
import { AgentStateAnnotation, type UserRole } from "./agents/agentState.js";
export type { UserRole, NextAgent, AgentState } from "./agents/agentState.js";
import { getCatalog, getActiveCatalogEntry, buildSchemaDefinition } from "./db/data-lake.js";
import dotenv from "dotenv";

dotenv.config();

const checkpointer = new MemorySaver();

export async function clearConversationMemory() {
    try {
        const storage = (checkpointer as any).storage as Record<string, unknown> | undefined;
        if (!storage) return;

        for (const threadId of Object.keys(storage)) {
            try {
                await checkpointer.deleteThread(threadId);
            } catch {
                // ignore individual thread deletion errors
            }
        }
    } catch {
        // ignore if storage is inaccessible
    }
}

function routerCondition(state: any): string {
    return state.nextAgent === "END" || !state.nextAgent ? "__end__" : state.nextAgent;
}

const workflow = new StateGraph(AgentStateAnnotation)
    .addNode("Supervisor", supervisorNode)
    .addNode("FinanceAgent", financeAgentNode)
    .addNode("TechAgent", techAgentNode)
    .addNode("DataScientistAgent", dataScientistNode)
    .addEdge("__start__", "Supervisor")
    .addConditionalEdges("Supervisor", routerCondition, {
        "FinanceAgent": "FinanceAgent",
        "TechAgent": "TechAgent",
        "DataScientistAgent": "DataScientistAgent",
        "__end__": "__end__"
    })
    .addEdge("FinanceAgent", "__end__")
    .addEdge("TechAgent", "__end__")
    .addEdge("DataScientistAgent", "__end__");

export const multiAgentApp = workflow.compile({ checkpointer });

export async function runMultiAgent(query: string, userRole: UserRole, threadId: string, visualRequest: boolean = false, userId?: string): Promise<string> {
    const tracing = initTracing();
    const config: Record<string, any> = { configurable: { thread_id: threadId } };
    if (tracing.handler) config.callbacks = [tracing.handler];
    // Cache catalog once at request start
    const catalog = await getCatalog(userId || "system").catch(() => []);
    const activeEntry = await getActiveCatalogEntry(userId || "system").catch(() => null);
    const schema = activeEntry ? await buildSchemaDefinition(activeEntry).catch(() => "") : "";
    const result = await multiAgentApp.invoke(
        { messages: [{ role: "user", content: query }], userRole, visualRequest, userId, cachedCatalog: catalog, cachedSchema: schema, cachedActiveEntry: activeEntry },
        config
    );
    const messages = (result as any).messages;
    const lastMsg = messages[messages.length - 1];
    return lastMsg?.content ?? "";
}

export async function runMultiAgentStream(
    query: string,
    userRole: UserRole,
    threadId: string,
    onChunk: (chunk: string) => void,
    visualRequest: boolean = false,
    userId?: string
): Promise<void> {
    const tracing = initTracing();
    const config: Record<string, any> = { configurable: { thread_id: threadId, onChunk } };
    if (tracing.handler) config.callbacks = [tracing.handler];
    const catalog = await getCatalog(userId || "system").catch(() => []);
    const activeEntry = await getActiveCatalogEntry(userId || "system").catch(() => null);
    const schema = activeEntry ? await buildSchemaDefinition(activeEntry).catch(() => "") : "";
    await multiAgentApp.invoke(
        { messages: [{ role: "user", content: query }], userRole, visualRequest, userId, cachedCatalog: catalog, cachedSchema: schema, cachedActiveEntry: activeEntry },
        config
    );
}

export async function runMultiAgentSecure(
    query: string,
    authToken: string,
    threadId: string
): Promise<string> {
    const auth = verifyToken(authToken);
    if (!auth.success || !auth.payload) throw new Error(`Authentication failed: ${auth.error}`);
    const { userId, role } = auth.payload;
    const result = await multiAgentApp.invoke(
        { messages: [{ role: "user", content: query }], userRole: role, userId },
        { configurable: { thread_id: threadId } }
    );
    const lastMsg = (result as any).messages[(result as any).messages.length - 1];
    return lastMsg?.content ?? "";
}
