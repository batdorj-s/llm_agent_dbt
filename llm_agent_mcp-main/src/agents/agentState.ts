import { Annotation } from "@langchain/langgraph";
import type { DataLakeCatalogEntry } from "../db/data-lake.js";
import type { ModelTier } from "./model-router.js";

export type UserRole = "viewer" | "analyst" | "admin";
export type NextAgent = "FinanceAgent" | "TechAgent" | "DataScientistAgent" | "END";

export interface Message {
    role: "user" | "assistant" | "system";
    content: string;
}

export interface ThinkingEvent {
    type: "thinking";
    step: "routing" | "rag" | "sql" | "analysis" | "delegation";
    agent?: string;
    message: string;
}

export interface AgentConfig {
    configurable?: {
        onChunk?: (text: string) => void;
        onEvent?: (event: ThinkingEvent) => void;
        threadId?: string;
    };
}

export interface AgentState {
    messages: Message[];
    userRole: UserRole;
    userId?: string;
    nextAgent?: NextAgent;
    visualRequest?: boolean;
    cachedCatalog?: DataLakeCatalogEntry[];
    cachedSchema?: string;
    cachedActiveEntry?: DataLakeCatalogEntry | null;
    sanitizedQuery?: string;
    modelTier?: ModelTier;
}

export const AgentStateAnnotation = Annotation.Root({
    messages: Annotation<Message[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
    }),
    userRole: Annotation<UserRole>({
        reducer: (x, y) => y ?? x,
        default: () => "viewer",
    }),
    userId: Annotation<string | undefined>({
        reducer: (x, y) => y ?? x,
        default: () => undefined,
    }),
    nextAgent: Annotation<NextAgent>({
        reducer: (x, y) => y ?? x,
        default: () => "END",
    }),
    visualRequest: Annotation<boolean>({
        reducer: (x, y) => y ?? x,
        default: () => false,
    }),
    cachedCatalog: Annotation<DataLakeCatalogEntry[] | undefined>({
        reducer: (x, y) => y ?? x,
        default: () => undefined,
    }),
    cachedSchema: Annotation<string | undefined>({
        reducer: (x, y) => y ?? x,
        default: () => undefined,
    }),
    cachedActiveEntry: Annotation<DataLakeCatalogEntry | null | undefined>({
        reducer: (x, y) => y ?? x,
        default: () => undefined,
    }),
    sanitizedQuery: Annotation<string | undefined>({
        reducer: (x, y) => y ?? x,
        default: () => undefined,
    }),
    modelTier: Annotation<ModelTier>({
        reducer: (x, y) => y ?? x,
        default: () => "fast",
    }),
});

const MAX_HISTORY_MESSAGES = 10;

export function trimMessages(messages: Message[]): Message[] {
    const systemMsg = messages.filter((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");
    const trimmed = nonSystem.slice(-MAX_HISTORY_MESSAGES);
    return [...systemMsg, ...trimmed];
}

export function buildContextSummary(messages: Message[]): string {
    // Include last 3 user messages and last 2 assistant messages for full context
    const userMsgs = messages.filter(m => m.role === "user").slice(-3);
    const assistantMsgs = messages.filter(m => m.role === "assistant").slice(-2);
    if (userMsgs.length === 0 && assistantMsgs.length === 0) return "";

    const parts: string[] = [];
    for (const msg of userMsgs) {
        parts.push(`User: ${msg.content.slice(0, 200)}`);
    }
    for (const msg of assistantMsgs) {
        const text = msg.content.replace(/<visual>[\s\S]*?<\/visual>/g, "").replace(/<dashboard>[\s\S]*?<\/dashboard>/g, "").trim();
        if (text.length > 500) {
            const sentences = text.split(/[.?\n]/).filter(s => s.trim());
            const summary = sentences.slice(0, 3).join(". ") + ".";
            parts.push(`Assistant: ${summary}`);
        } else {
            parts.push(`Assistant: ${text}`);
        }
    }
    return parts.length > 0
        ? `\n\n## Conversation Context (previous messages)\n${parts.join("\n")}`
        : "";
}

export const DEFAULT_AGENT_TIMEOUT_MS = parseInt(process.env.DEFAULT_AGENT_TIMEOUT_MS || "40000", 10);

export async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number = DEFAULT_AGENT_TIMEOUT_MS): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}
