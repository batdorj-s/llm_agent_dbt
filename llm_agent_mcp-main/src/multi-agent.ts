import { StateGraph, MessagesAnnotation, MemorySaver, Annotation } from "@langchain/langgraph";
import { createLLM, printProviderStatus } from "./llm-provider.js";
import { executeSql, getCatalog, getActiveCatalogEntry, buildSchemaDefinition } from "./db/data-lake.js";
import { searchKnowledgeBase } from "./rag.js";
import { verifyToken } from "./auth.js";
import { agentLimiter, sandboxLimiter } from "./rate-limiter.js";
import fs from "fs";
import yaml from "yaml";
import { z } from "zod";
import { CallbackHandler } from "langfuse-langchain";
import dotenv from "dotenv";

dotenv.config();

// Load Prompts from YAML (Prompt-as-Code)
const promptFile = fs.readFileSync("./src/prompts.yaml", "utf8");
const prompts = yaml.parse(promptFile);

// Langfuse Tracing Setup (Observability)
const langfuseHandler = new CallbackHandler({
  secretKey: process.env.LANGFUSE_SECRET_KEY || "mock_sk",
  publicKey: process.env.LANGFUSE_PUBLIC_KEY || "mock_pk",
  baseUrl: process.env.LANGFUSE_HOST || "https://cloud.langfuse.com",
});

// 1. Define custom state for Phase 3 (Unified Access)
export type UserRole = "admin";
export type NextAgent = "FinanceAgent" | "TechAgent" | "END";

export interface Message {
    role: "user" | "assistant" | "system";
    content: string;
}

export interface AgentState {
    messages: Message[];
    userRole: UserRole;
    nextAgent?: NextAgent;
    visualRequest?: boolean;
}

// State annotation for LangGraph
export const AgentStateAnnotation = Annotation.Root({
    messages: Annotation<Message[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
    }),
    userRole: Annotation<UserRole>({
        reducer: (x, y) => y ?? x,
        default: () => "admin",
    }),
    nextAgent: Annotation<NextAgent>({
        reducer: (x, y) => y ?? x,
        default: () => "END",
    }),
    visualRequest: Annotation<boolean>({
        reducer: (x, y) => y ?? x,
        default: () => false,
    }),
});

// Memory setup (Phase 3 requirement)
const checkpointer = new MemorySaver();
const LLM_TIMEOUT_MS = 12000;

export async function clearConversationMemory() {
    const storage = (checkpointer as any).storage as Record<string, unknown> | undefined;
    if (!storage) return;

    for (const threadId of Object.keys(storage)) {
        await checkpointer.deleteThread(threadId);
    }
}

function buildActiveSchemaContext(query: string): string {
    const activeEntry = getActiveCatalogEntry();
    if (!activeEntry) {
        return "(catalog unavailable)";
    }

    const lowerQuery = query.toLowerCase();
    const catalog = getCatalog();
    const explicitlyMentioned = catalog.filter((row: any) => lowerQuery.includes(row.table_name.toLowerCase()));
    const tablesToInclude = explicitlyMentioned.length > 0 ? explicitlyMentioned : [activeEntry];

    return buildSchemaDefinition(tablesToInclude as any);
}

function getActiveColumns(entry = getActiveCatalogEntry()): string[] {
    if (!entry) return [];
    try {
        return JSON.parse(entry.columns_info) as string[];
    } catch {
        return [];
    }
}

function findColumn(columns: string[], patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
        const match = columns.find((column) => pattern.test(column));
        if (match) return match;
    }
    return null;
}

function buildDeterministicTechSql(query: string, entry = getActiveCatalogEntry()): string | null {
    if (!entry) return null;

    const lowerQuery = query.toLowerCase();
    const columns = getActiveColumns(entry);
    const tableName = entry.table_name;

    const itemColumn = findColumn(columns, [
        /item_purchased/i,
        /product/i,
        /item/i,
    ]);
    const salesColumn = findColumn(columns, [
        /purchase_amount/i,
        /total_amount/i,
        /sales/i,
        /revenue/i,
        /amount/i,
    ]);

    if (itemColumn && salesColumn && (lowerQuery.includes("top 5") || lowerQuery.includes("top five") || lowerQuery.includes("first 5") || lowerQuery.includes("эхний 5") || lowerQuery.includes("хамгийн их"))) {
        return `
            WITH item_revenue AS (
                SELECT
                    "${itemColumn}" AS item_name,
                    SUM(COALESCE("${salesColumn}", 0)) AS total_revenue
                FROM "${tableName}"
                GROUP BY "${itemColumn}"
            )
            SELECT item_name, total_revenue
            FROM item_revenue
            ORDER BY total_revenue DESC
            LIMIT 5;
        `.trim();
    }

    if (lowerQuery.includes("count") || lowerQuery.includes("how many") || lowerQuery.includes("нийт хэдэн") || lowerQuery.includes("гүйлгээ")) {
        return `SELECT COUNT(*) AS total_rows FROM "${tableName}";`;
    }

    return null;
}

function formatDeterministicTechResponse(query: string, sql: string, results: any[]): string {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes("top 5") || lowerQuery.includes("top five") || lowerQuery.includes("first 5") || lowerQuery.includes("эхний 5") || lowerQuery.includes("хамгийн их")) {
        const lines = results.map((row, index) => {
            const itemName = row.item_name ?? row.item_purchased ?? row.product ?? "Unknown";
            const revenue = Number(row.total_revenue ?? row.revenue ?? 0);
            return `${index + 1}. ${itemName} — ${revenue.toLocaleString()} USD`;
        });

        return [
            "SQL query executed directly from the active dataset.",
            "",
            "```sql",
            sql,
            "```",
            "",
            "### Үр дүн",
            ...lines,
        ].join("\n");
    }

    if (lowerQuery.includes("count") || lowerQuery.includes("how many") || lowerQuery.includes("нийт хэдэн") || lowerQuery.includes("гүйлгээ")) {
        const totalRows = Number(results[0]?.total_rows ?? 0);
        return [
            "SQL query executed directly from the active dataset.",
            "",
            "```sql",
            sql,
            "```",
            "",
            `Нийт мөрийн тоо: ${totalRows.toLocaleString()}`,
        ].join("\n");
    }

    return [
        "SQL query executed directly from the active dataset.",
        "",
        "```sql",
        sql,
        "```",
        "",
        "```json",
        JSON.stringify(results, null, 2),
        "```",
    ].join("\n");
}

function isRateLimitError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /rate limit|429|tokens per day|TPD/i.test(message);
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number = LLM_TIMEOUT_MS): Promise<T> {
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

// ─────────────────────────────────────────────────────────────
// Routing schema for LLM structured output
// ─────────────────────────────────────────────────────────────
const RouteSchema = z.object({
    route: z.enum(["FinanceAgent", "TechAgent", "END"])
        .describe("Which agent to route to. FinanceAgent for business/financial queries, TechAgent for coding/data/math, END otherwise."),
    reason: z.string().describe("One sentence explaining the routing decision.")
});

async function supervisorNode(state: any, config?: any): Promise<Partial<AgentState>> {
    const lastMsg = state.messages[state.messages.length - 1];
    if (!lastMsg) return { nextAgent: "END" };

    const lastMessage = lastMsg.content;
    console.log(`[Supervisor] Analyzing query: "${lastMessage}"`);

    const systemPrompt = prompts.supervisor;
    const onChunk = config?.configurable?.onChunk;

    const lowerMessage = lastMessage.toLowerCase();
    const catalog = getCatalog();
    const mentionsKnownTable = catalog.some((row: any) => lowerMessage.includes(row.table_name.toLowerCase()));
    const techSignals = [
        "sql",
        "database",
        "table",
        "tables",
        "column",
        "columns",
        "hүснэгт",
        "багана",
        "code",
        "python",
        "math",
        "calculate",
        "analysis",
        "item purchased",
        "purchased",
        "top 5",
        "first 5",
        "эхний 5",
        "хамгийн их",
        "борлуулалт",
        "борлуулалтад",
        "орлого",
        "орлогын",
    ];
    const financeSignals = ["sales", "finance", "revenue", "target"];
    const immediateRoute: NextAgent | null = mentionsKnownTable || techSignals.some((word) => lowerMessage.includes(word))
        ? "TechAgent"
        : financeSignals.some((word) => lowerMessage.includes(word))
            ? "FinanceAgent"
            : null;

    if (immediateRoute) {
        console.log(`[Supervisor] Immediate keyword route -> ${immediateRoute}`);
        return { nextAgent: immediateRoute };
    }

    // Attempt LLM-based routing first
    const llm = await createLLM({ temperature: 0 });
    if (llm) {
        try {
            const structured = (llm as any).withStructuredOutput(RouteSchema);
            const result = await withTimeout<{ route: NextAgent; reason: string }>(structured.invoke([
                { role: "system", content: systemPrompt },
                { role: "user", content: lastMessage }
            ]), "Supervisor routing");
            console.log(`[Supervisor] LLM routed to -> ${result.route} (${result.reason})`);
            
            if (result.route === "END") {
                const endSystemPrompt = prompts.supervisor_end;
                try {
                    const stream = await withTimeout(llm.stream([
                        { role: "system", content: endSystemPrompt },
                        ...state.messages.map((m: any) => ({ role: m.role, content: m.content }))
                    ]), "Supervisor end response");
                    let fullText = "";
                    for await (const chunk of stream) {
                        const text = chunk.content as string;
                        fullText += text;
                        if (onChunk) onChunk(text);
                    }
                    return {
                        nextAgent: "END",
                        messages: [{ role: "assistant", content: fullText }]
                    };
                } catch (streamErr) {
                    const fallback = "Сайн байна уу! Би байгууллагын AI зохицуулагч байна. Одоогоор хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу.";
                    console.warn("[Supervisor] End response failed:", (streamErr as Error).message);
                    if (onChunk) onChunk(fallback);
                    return {
                        nextAgent: "END",
                        messages: [{ role: "assistant", content: fallback }]
                    };
                }
            }
            
            return { nextAgent: result.route };
        } catch (err) {
            console.warn("[Supervisor] LLM routing failed, using keyword fallback:", (err as Error).message);
        }
    } else {
        console.log("[Supervisor] No LLM API key — using keyword routing fallback.");
    }

    // Keyword fallback
    let route: NextAgent = "END";
    if (mentionsKnownTable || techSignals.some((word) => lowerMessage.includes(word))) {
        route = "TechAgent";
    } else if (financeSignals.some((word) => lowerMessage.includes(word))) {
        route = "FinanceAgent";
    }
    console.log(`[Supervisor] Keyword routed to -> ${route}`);
    
    if (route === "END") {
        const text = "Сайн байна уу! Би байгууллагын AI зохицуулагч байна. Би танд санхүүгийн асуултууд, борлуулалтын KPI болон код ажиллуулах даалгавар өгөхөд тусалж чадна. Надаас 'борлуулалтын зорилтот дүн' эсвэл код ажиллуулах талаар асуугаарай.";
        if (onChunk) onChunk(text);
        return {
            nextAgent: "END",
            messages: [{ role: "assistant", content: text }]
        };
    }
    return { nextAgent: route };
}

// 3. Finance Domain Agent
async function financeAgentNode(state: any, config?: any): Promise<Partial<AgentState>> {
    console.log("[Finance Agent] Activated.");
    const onChunk = config?.configurable?.onChunk;

    const lastMsg = state.messages[state.messages.length - 1];
    const query = lastMsg ? lastMsg.content : "sales targets";

    console.log(`[Finance Agent] Fetching RAG context for query: "${query}"`);
    let context = "No context available.";
    try {
        const ragData = await searchKnowledgeBase(query, 2);
        const docs = ragData.documents?.[0] ?? [];
        if (docs.length > 0) {
            context = docs.join("\n");
        } else {
            console.warn("[Finance Agent] RAG returned no documents.");
        }
    } catch (err) {
        console.error("[Finance Agent] RAG search failed:", err);
    }

    const llm = await createLLM({ temperature: 0 });
    if (!llm) {
        const fallback = `(Finance Agent)\nBased on RAG:\n${context}`;
        if (onChunk) onChunk(fallback);
        return {
            messages: [{ role: "assistant", content: fallback }]
        };
    }

    // Prepend the required indicator (Finance Agent) for Next.js routing visualizer
    const prefix = "(Finance Agent)\n";
    if (onChunk) onChunk(prefix);

    const financePrompt = prompts.finance_agent;
    const systemPrompt = `${financePrompt}\n\nHere is the retrieved business context:\n${context}`;
    try {
        const stream = await withTimeout(llm.stream([
            { role: "system", content: systemPrompt },
            ...state.messages.map((m: any) => ({ role: m.role, content: m.content }))
        ]), "Finance agent response");

        let fullText = prefix;
        for await (const chunk of stream) {
            const text = chunk.content as string;
            fullText += text;
            if (onChunk) onChunk(text);
        }

        return {
            messages: [{ role: "assistant", content: fullText }]
        };
    } catch (streamErr) {
        const fallback = `${prefix}⚠️ Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу.`;
        console.warn("[Finance Agent] Response failed:", (streamErr as Error).message);
        if (onChunk) onChunk(fallback);
        return {
            messages: [{ role: "assistant", content: fallback }]
        };
    }
}

// 4. Tech / Data Domain Agent (Using SQL Data Lake)
async function techAgentNode(state: any, config?: any): Promise<Partial<AgentState>> {
    console.log("[Tech Agent] Activated. Writing SQL query...");
    const onChunk = config?.configurable?.onChunk;

    const lastMsg = state.messages[state.messages.length - 1];
    const query = lastMsg ? lastMsg.content : "";

    const llm = await createLLM({ temperature: 0 });
    if (!llm) {
        const fallback = `(Tech Agent)\n⚠️ No LLM API key configured to generate dynamic SQL code.`;
        if (onChunk) onChunk(fallback);
        return {
            messages: [{ role: "assistant", content: fallback }]
        };
    }

    const prefix = "(Tech Agent)\nМэдээллийн сангаас дата шүүж байна... (Data Lake-д SQL/CTE ажиллуулж байна)\n\n";
    if (onChunk) onChunk(prefix);

    console.log(`[Tech Agent] Fetching Data Lake catalog schema...`);
    const schemaContext = buildActiveSchemaContext(query);
    try {
        console.log(`[Tech Agent] Active schema context:\n${schemaContext}`);
    } catch (err) {
        console.error("[Tech Agent] Schema lookup failed:", err);
    }

    const activeEntry = getActiveCatalogEntry();
    const deterministicSql = buildDeterministicTechSql(query, activeEntry);
    if (deterministicSql && activeEntry) {
        try {
            const results = executeSql(deterministicSql);
            const normalizedResults = Array.isArray(results) ? results : [results];
            const directResponse = formatDeterministicTechResponse(query, deterministicSql, normalizedResults);
            if (onChunk) onChunk("\n\n" + directResponse);
            return {
                messages: [{ role: "assistant", content: `${prefix}\n${directResponse}` }]
            };
        } catch (err: any) {
            console.warn("[Tech Agent] Deterministic SQL fallback failed, continuing with LLM:", err.message);
        }
    }

    let sqlCode = "";
    let sandboxResult = "";
    let isSuccess = false;
    let attempts = 0;
    const maxAttempts = 2;
    let feedback = "";
    let accumulatedText = prefix;

    while (attempts < maxAttempts) {
        attempts++;
        console.log(`[Tech Agent] SQL generation attempt ${attempts}/${maxAttempts}...`);
        
        if (onChunk && attempts > 1) {
            const warning = `\n*⚠️ Системд алдаа гарлаа. Алдааг автоматаар засварлан дахин ажиллуулж байна (Оролдлого ${attempts}/${maxAttempts})...*\n`;
            onChunk(warning);
            accumulatedText += warning;
        }

        const sqlGenPrompt = (prompts.tech_agent_sql_gen as string).replace("{catalog}", schemaContext || "(catalog unavailable)");
        let userContent = `Task: ${query}`;
        if (feedback) {
            userContent += `\n\nYour previous SQL query failed with the following error:\n${feedback}\n\nPlease analyze this error and rewrite the SQL query to resolve it. Do not repeat the same query. Ensure you only use tables and columns available in the schema provided.`;
        }

        try {
            const codeGenResponse = await withTimeout(llm.invoke([
                { role: "system", content: sqlGenPrompt },
                { role: "user", content: userContent }
            ]), "Tech agent SQL generation");

            let rawCode = codeGenResponse.content as string;
            if (rawCode.includes("```sql")) {
                sqlCode = rawCode.split("```sql")[1].split("```")[0].trim();
            } else if (rawCode.includes("```")) {
                sqlCode = rawCode.split("```")[1].split("```")[0].trim();
            } else {
                sqlCode = rawCode.trim();
            }

            const results = executeSql(sqlCode);
            sandboxResult = JSON.stringify(results, null, 2);
            
            const logEntry = `\n### Оролдлого ${attempts}\n\`\`\`sql\n${sqlCode}\n\`\`\`\n*Үр дүн:*\n\`\`\`json\n${sandboxResult}\n\`\`\`\n`;
            if (onChunk) onChunk(logEntry);
            accumulatedText += logEntry;

            const isEmpty = sandboxResult.trim() === "[]" || sandboxResult.trim() === "";
            const hasError = sandboxResult.startsWith("SQL Execution Error:") || isEmpty;

            if (!hasError) {
                isSuccess = true;
                break;
            } else {
                if (isEmpty) {
                    feedback = `Error: The query returned an empty array []. Available tables: ${schemaContext}`;
                } else {
                    feedback = sandboxResult;
                }
            }
        } catch (err: any) {
            feedback = err.message;
            const errorEntry = `\n### Оролдлого ${attempts}\n*Алдаа:* ${err.message}\n`;
            if (onChunk) onChunk(errorEntry);
            accumulatedText += errorEntry;
            if (isRateLimitError(err)) {
                console.warn("[Tech Agent] LLM rate limit hit, stopping retries early.");
                break;
            }
        }
    }

    if (!isSuccess) {
        const fallback = `${accumulatedText}\n\n⚠️ Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу.`;
        if (onChunk) onChunk("\n\n⚠️ Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу.");
        return {
            messages: [{ role: "assistant", content: fallback }]
        };
    }

    const visualInstruction = state.visualRequest ? prompts.visual_designer : "";
    const explainSystemPrompt = (prompts.tech_agent_explain as string).replace("{visual_instruction}", visualInstruction);
    const explainPrompt = `${explainSystemPrompt}\n\n## Execution Log (Last Attempt)\nSQL: ${sqlCode}\nResult: ${sandboxResult}`;

    try {
        const stream = await withTimeout(llm.stream([
            { role: "system", content: explainPrompt },
            ...state.messages.map((m: any) => ({ role: m.role, content: m.content }))
        ]), "Tech agent explanation");

        if (onChunk) onChunk("\n\n");
        accumulatedText += "\n\n";

        for await (const chunk of stream) {
            const text = chunk.content as string;
            accumulatedText += text;
            if (onChunk) onChunk(text);
        }
    } catch (explainErr) {
        const fallback = "\n\n⚠️ Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу.";
        console.warn("[Tech Agent] Explanation failed:", (explainErr as Error).message);
        if (onChunk) onChunk(fallback);
        accumulatedText += fallback;
    }

    return {
        messages: [{ role: "assistant", content: accumulatedText }]
    };
}

function routerCondition(state: any): string {
    return state.nextAgent === "END" || !state.nextAgent ? "__end__" : state.nextAgent;
}

const workflow = new StateGraph(AgentStateAnnotation)
.addNode("Supervisor", supervisorNode)
.addNode("FinanceAgent", financeAgentNode)
.addNode("TechAgent", techAgentNode)
.addEdge("__start__", "Supervisor")
.addConditionalEdges("Supervisor", routerCondition, {
    "FinanceAgent": "FinanceAgent",
    "TechAgent": "TechAgent",
    "__end__": "__end__"
})
.addEdge("FinanceAgent", "__end__")
.addEdge("TechAgent", "__end__");

export const multiAgentApp = workflow.compile({ checkpointer });

export async function runMultiAgent(query: string, userRole: UserRole, threadId: string, visualRequest: boolean = false) {
    const config = { configurable: { thread_id: threadId } };
    await multiAgentApp.invoke(
        { messages: [{ role: "user", content: query }], userRole, visualRequest },
        config
    );
}

export async function runMultiAgentStream(
    query: string,
    userRole: UserRole,
    threadId: string,
    onChunk: (chunk: string) => void,
    visualRequest: boolean = false
): Promise<void> {
    const config = { configurable: { thread_id: threadId, onChunk } };
    await multiAgentApp.invoke(
        { messages: [{ role: "user", content: query }], userRole, visualRequest },
        config
    );
}

export async function runMultiAgentSecure(
    query: string,
    authToken: string,
    threadId: string
): Promise<string> {
    const auth = verifyToken(authToken);
    if (!auth.success || !auth.payload) throw new Error(`🛑 Authentication failed: ${auth.error}`);
    const { userId, role } = auth.payload;
    const result = await multiAgentApp.invoke(
        { messages: [{ role: "user", content: query }], userRole: role },
        { configurable: { thread_id: threadId } }
    );
    const lastMsg = (result as any).messages[(result as any).messages.length - 1];
    return lastMsg?.content ?? "";
}
