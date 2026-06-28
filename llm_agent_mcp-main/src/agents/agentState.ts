import { Annotation } from "@langchain/langgraph";

export type UserRole = "viewer" | "analyst" | "admin";
export type NextAgent = "FinanceAgent" | "TechAgent" | "DataScientistAgent" | "END";

export interface Message {
    role: "user" | "assistant" | "system";
    content: string;
}

export interface AgentState {
    messages: Message[];
    userRole: UserRole;
    userId?: string;
    nextAgent?: NextAgent;
    visualRequest?: boolean;
    // Cached request-lifetime data to avoid redundant DB calls
    cachedCatalog?: any[];
    cachedSchema?: string;
    cachedActiveEntry?: any;
    sanitizedQuery?: string;
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
    cachedCatalog: Annotation<any[] | undefined>({
        reducer: (x, y) => y ?? x,
        default: () => undefined,
    }),
    cachedSchema: Annotation<string | undefined>({
        reducer: (x, y) => y ?? x,
        default: () => undefined,
    }),
    cachedActiveEntry: Annotation<any | undefined>({
        reducer: (x, y) => y ?? x,
        default: () => undefined,
    }),
    sanitizedQuery: Annotation<string | undefined>({
        reducer: (x, y) => y ?? x,
        default: () => undefined,
    }),
});

const MAX_HISTORY_MESSAGES = 10;

export function trimMessages(messages: any[]): any[] {
    const systemMsg = messages.filter((m: any) => m.role === "system");
    const nonSystem = messages.filter((m: any) => m.role !== "system");
    const trimmed = nonSystem.slice(-MAX_HISTORY_MESSAGES);
    return [...systemMsg, ...trimmed];
}

export function buildContextSummary(messages: Message[]): string {
    const assistantMsgs = messages.filter(m => m.role === "assistant").slice(-2);
    if (assistantMsgs.length === 0) return "";
    const parts: string[] = [];
    for (const msg of assistantMsgs) {
        const text = msg.content.replace(/<visual>[\s\S]*?<\/visual>/g, "").replace(/<dashboard>[\s\S]*?<\/dashboard>/g, "").trim();
        if (text.length > 500) {
            const sentences = text.split(/[.?\n]/).filter(s => s.trim());
            const summary = sentences.slice(0, 3).join(". ") + ".";
            parts.push(summary);
        } else {
            parts.push(text);
        }
    }
    return parts.length > 0
        ? `\n\n## Context Summary (from previous assistant responses)\n${parts.join("\n---\n")}`
        : "";
}

export async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number = 40000): Promise<T> {
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
