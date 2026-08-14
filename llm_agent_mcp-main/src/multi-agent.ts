import { StateGraph, MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";
import { dataScientistNode } from "./agents/data-scientist.js";
import { financeAgentNode } from "./agents/financeAgentNode.js";
import { techAgentNode } from "./agents/techAgentNode.js";
import { supervisorNode } from "./agents/supervisorNode.js";
import { verifyToken } from "./auth.js";
import { initTracing } from "./observability/tracer.js";
import { AgentStateAnnotation, type AgentState, type UserRole, type ThinkingEvent } from "./agents/agentState.js";
export type { UserRole, NextAgent, AgentState, ThinkingEvent } from "./agents/agentState.js";
import { getCatalog, getActiveCatalogEntry, buildSchemaDefinition } from "./db/data-lake.js";
import { buildSslConfig } from "./db/pool.js";
import dotenv from "dotenv";

dotenv.config();

function createCheckpointer(): BaseCheckpointSaver {
    const mode = process.env.LANGGRAPH_CHECKPOINTER ?? "auto";
    const usePostgres = mode === "postgres" || (mode === "auto" && process.env.NODE_ENV !== "test" && !!process.env.DATABASE_URL);
    if (usePostgres && process.env.DATABASE_URL) {
        try {
            const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: buildSslConfig(process.env.DATABASE_URL) });
            console.log("[Checkpointer] Using PostgresSaver (persistent thread state)");
            return new PostgresSaver(pool, undefined, { schema: "public" });
        } catch (err) {
            console.warn(`[Checkpointer] Failed to create PostgresSaver: ${err instanceof Error ? err.message : String(err)} — falling back to MemorySaver`);
        }
    }
    if (process.env.NODE_ENV !== "test") {
        console.warn("[Checkpointer] Using in-memory MemorySaver — thread state resets on restart. Set DATABASE_URL (or LANGGRAPH_CHECKPOINTER=postgres) for persistence.");
    }
    return new MemorySaver();
}

const checkpointer = createCheckpointer();

let checkpointerSetupPromise: Promise<void> | null = null;

interface PostgresSaverInternals {
    isSetup: boolean;
    options: { schema: string };
    pool: Pool;
}

function pgSaverInternals(saver: BaseCheckpointSaver): PostgresSaverInternals | null {
    return saver instanceof PostgresSaver ? (saver as unknown as PostgresSaverInternals) : null;
}

async function ensureCheckpointerReady(): Promise<void> {
    const internal = pgSaverInternals(checkpointer);
    if (!internal || internal.isSetup) return;
    if (!checkpointerSetupPromise) {
        checkpointerSetupPromise = (checkpointer as PostgresSaver).setup().catch((err) => {
            checkpointerSetupPromise = null;
            throw err;
        });
    }
    return checkpointerSetupPromise;
}

export async function clearConversationMemory() {
    try {
        const internal = pgSaverInternals(checkpointer);
        if (internal) {
            const schema = internal.options?.schema ?? "public";
            const result = await internal.pool.query(`SELECT DISTINCT thread_id FROM "${schema}".checkpoints`);
            for (const row of result.rows as Array<{ thread_id: string }>) {
                try {
                    await checkpointer.deleteThread(row.thread_id);
                } catch {
                    // ignore individual thread deletion errors
                }
            }
            return;
        }

        const storage = (checkpointer as MemorySaver).storage;
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

function routerCondition(state: AgentState): string {
    return state.nextAgent === "END" || !state.nextAgent ? "__end__" : state.nextAgent;
}

function financeRouterCondition(state: AgentState): string {
    return state.nextAgent === "TechAgent" ? "TechAgent" : "__end__";
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
    .addConditionalEdges("FinanceAgent", financeRouterCondition, {
        "TechAgent": "TechAgent",
        "__end__": "__end__"
    })
    .addEdge("TechAgent", "__end__")
    .addEdge("DataScientistAgent", "__end__");

export const multiAgentApp = workflow.compile({ checkpointer });

export async function runMultiAgent(query: string, userRole: UserRole, threadId: string, visualRequest: boolean = false, userId?: string): Promise<string> {
    await ensureCheckpointerReady();
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
    userId?: string,
    onEvent?: (event: ThinkingEvent) => void
): Promise<void> {
    await ensureCheckpointerReady();
    const tracing = initTracing();
    const config: Record<string, any> = { configurable: { thread_id: threadId, onChunk, onEvent } };
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
    await ensureCheckpointerReady();
    const result = await multiAgentApp.invoke(
        { messages: [{ role: "user", content: query }], userRole: role, userId },
        { configurable: { thread_id: threadId } }
    );
    const lastMsg = (result as any).messages[(result as any).messages.length - 1];
    return lastMsg?.content ?? "";
}
