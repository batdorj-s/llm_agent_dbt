import { StateGraph, MessagesAnnotation, MemorySaver, Annotation } from "@langchain/langgraph";
import { createLLM, createLLMWithOrder, printProviderStatus } from "./llm-provider.js";
import { getCatalog, getActiveCatalogEntry, buildSchemaDefinition } from "./db/data-lake.js";
import { searchKnowledgeBase } from "./rag.js";
import { buildFinanceKpiContext, handleExecuteSql, isPythonQuery } from "./tools/enterprise-tools.js";
import { runPythonCode } from "./sandbox.js";
import { verifyToken } from "./auth.js";
import fs from "fs";
import yaml from "yaml";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const promptFile = fs.readFileSync("./src/prompts.yaml", "utf8");
const prompts = yaml.parse(promptFile);

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

const checkpointer = new MemorySaver();
const LLM_TIMEOUT_MS = 40000;
const SQL_GEN_TIMEOUT_MS = 55000;
const MAX_HISTORY_MESSAGES = 6;

function trimMessages(messages: any[]): any[] {
    const systemMsg = messages.filter((m: any) => m.role === "system");
    const nonSystem = messages.filter((m: any) => m.role !== "system");
    const trimmed = nonSystem.slice(-MAX_HISTORY_MESSAGES);
    return [...systemMsg, ...trimmed];
}

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

async function buildActiveSchemaContext(query: string): Promise<string> {
    const catalog = await getCatalog();
    if (!catalog || catalog.length === 0) return "(catalog unavailable)";

    const mentioned = catalog.find((e: any) =>
        query.toLowerCase().includes(e.table_name.toLowerCase())
    );
    if (mentioned) return await buildSchemaDefinition(mentioned);

    const active = await getActiveCatalogEntry();
    if (active) return await buildSchemaDefinition(active);

    return await buildSchemaDefinition(catalog as any);
}

async function getActiveColumns(entry = getActiveCatalogEntry()): Promise<string[]> {
    const resolved = await entry;
    if (!resolved) return [];
    try {
        return JSON.parse(resolved.columns_info) as string[];
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

async function buildDeterministicTechSql(query: string, entry?: import("./db/data-lake.js").DataLakeCatalogEntry | null): Promise<string | null> {
    const resolvedEntry = entry ?? await getActiveCatalogEntry();
    if (!resolvedEntry) return null;

    const lowerQuery = query.toLowerCase();
    const columns = await getActiveColumns(Promise.resolve(resolvedEntry));
    const tableName = resolvedEntry.table_name;

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

    if (lowerQuery.includes("count") || lowerQuery.includes("how many") || lowerQuery.includes("нийт хэдэн") || lowerQuery.includes("гүйлгээ") || lowerQuery.includes("хэдэн") || lowerQuery.includes("хэд")) {
        if (lowerQuery.includes("дундаж") || lowerQuery.includes("average") || lowerQuery.includes("avg")) {
            const avgCol = findColumn(columns, [/age/i, /balance/i, /salary/i, /income/i, /spend/i, /amount/i, /price/i, /value/i]);
            if (avgCol) {
                return `SELECT COUNT(*) AS total_rows, AVG("${avgCol}") AS average_value FROM "${tableName}";`;
            }
        }
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

    if (lowerQuery.includes("count") || lowerQuery.includes("how many") || lowerQuery.includes("нийт хэдэн") || lowerQuery.includes("гүйлгээ") || lowerQuery.includes("хэдэн") || lowerQuery.includes("хэд")) {
        if (lowerQuery.includes("дундаж") || lowerQuery.includes("average") || lowerQuery.includes("avg")) {
            const totalRows = Number(results[0]?.total_rows ?? 0);
            const avgVal = Number(results[0]?.average_value ?? 0);
            return [
                "```sql",
                sql,
                "```",
                "",
                `Нийт мөрийн тоо: ${totalRows.toLocaleString()}`,
                `Дундаж утга: ${avgVal.toLocaleString()}`,
            ].join("\n");
        }
        const totalRows = Number(results[0]?.total_rows ?? 0);
        return [
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
    return /rate limit|429|tokens per day|TPD|quota exceeded|quota.*limit/i.test(message);
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

const RouteSchema = z.object({
    route: z.enum(["FinanceAgent", "TechAgent", "END"])
        .describe("Which agent to route to. FinanceAgent for business/financial queries, TechAgent for coding/data/math, END otherwise."),
    reason: z.string().describe("One sentence explaining the routing decision.")
});

const MAX_SQL_RETRIES = 2;

async function supervisorNode(state: any, config?: any): Promise<Partial<AgentState>> {
    const lastMsg = state.messages[state.messages.length - 1];
    if (!lastMsg) return { nextAgent: "END" };

    const lastMessage = lastMsg.content;
    console.log(`[Supervisor] Analyzing query: "${lastMessage}"`);

    const systemPrompt = prompts.supervisor;
    const onChunk = config?.configurable?.onChunk;

    const lowerMessage = lastMessage.toLowerCase();
    const catalog = await getCatalog();
    const mentionsKnownTable = catalog.some((row: any) => lowerMessage.includes(row.table_name.toLowerCase()));
    
    const techSignals = [
        "sql", "database", "table", "tables", "column", "columns", "хүснэгт", "багана",
        "code", "python", "pandas", "matplotlib", "math", "calculate", "analysis", "item purchased", "purchased",
        "top 5", "first 5", "эхний 5", "хамгийн их", "дата", "өгөгдөл", "query", "код ажиллуул",
        "харуул", "нийт", "нийлбэр", "дундаж", "тоо", "тоолох", "жагсаал", "жагсаалт",
        "шинжилгээ", "шинжил", "задла", "задлан", "гаргаж", "гаргах", "тооцо", "тооцоол",
        "хамгийн бага", "хамгийн өндөр",
        "хэд", "хэдэн", "нийт хэдэн", "гүйлгээ", "бүтээгдэхүүн", "бараа",
        "chart", "graph", "visualize", "plot", "харагдуул", "зур",
        "dashboard", "ханалтын самбар", "хана", "widget", "вижет",
        "count", "sum", "average", "avg", "total", "group by", "order by", "where", "filter",
        "show me", "list", "give me", "find", "get", "fetch", "select",
        "өгөгдөл", "мэдээлэл", "харуулах", "тооцоолох", "тооцоо",
        "шүүх", "шүүлт", "фильтр", "фильтрлэх", "бүлэглэх", "бүлэг",
        "эрэмбэлэх", "эрэмбэ", "ангилах", "ангилал",
        "мөр", "мөрүүд", "утга", "утгууд",
        "analyze", "analytics", "report", "top", "bottom",
        "highest", "lowest", "maximum", "minimum", "summarize", "summary",
        "aggregate", "trend", "compare", "comparison",
        "rank", "percentage", "distribution", "breakdown",
        "describe", "stats", "statistics", "overview",
        "first", "last", "limit", "offset",
        "purchase", "channel", "suva", "суваг", "худалдан авалт", "худалдаа",
        "platform", "платформ", "source", "эх сурвалж",
        "даргаар", "зарлага", "зардал", "кампанит",
        "campaign", "marketing", "маркетинг", "ad", "advertising", "зар",
        "conversion", "хөрвүүлэлт", "impression", "reach",
        "click", "тогших", "rate", "cost", "spend",
    ];
    const financeSignals = [
        "sales target", "revenue target", "profit target", "margin target", "kpi", "kpi target",
        "борлуулалтын төлөвлөгөө", "орлогын төлөвлөгөө", "ашгийн төлөвлөгөө",
    ];

    const hasTech = techSignals.some((word) => lowerMessage.includes(word)) || mentionsKnownTable;
    const hasFinance = financeSignals.some((word) => lowerMessage.includes(word));

    let immediateRoute: NextAgent | null = null;
    if (hasTech && hasFinance) {
        console.log("[Supervisor] Hybrid query detected. Defaulting to TechAgent for data analysis.");
        immediateRoute = "TechAgent";
    } else if (hasTech) {
        immediateRoute = "TechAgent";
    } else if (hasFinance) {
        immediateRoute = "FinanceAgent";
    }

    if (immediateRoute) {
        console.log(`[Supervisor] Immediate keyword route -> ${immediateRoute}`);
        return { nextAgent: immediateRoute };
    }

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
                const activeEntry = await getActiveCatalogEntry();
                if (activeEntry) {
                    console.log(`[Supervisor] LLM routed to END but active dataset '${activeEntry.table_name}' found. Overriding to TechAgent.`);
                    return { nextAgent: "TechAgent" };
                }
                const endSystemPrompt = prompts.supervisor_end;
                try {
                    const stream = await withTimeout(llm.stream(trimMessages([
                        { role: "system", content: endSystemPrompt },
                        ...state.messages.map((m: any) => ({ role: m.role, content: m.content }))
                    ])), "Supervisor end response");
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

    let route: NextAgent = "END";
    if (mentionsKnownTable || techSignals.some((word) => lowerMessage.includes(word))) {
        route = "TechAgent";
    } else if (financeSignals.some((word) => lowerMessage.includes(word))) {
        route = "FinanceAgent";
    }
    console.log(`[Supervisor] Keyword routed to -> ${route}`);

    if (route === "END") {
        const activeEntry = await getActiveCatalogEntry();
        if (activeEntry) {
            console.log(`[Supervisor] No keyword match but active dataset '${activeEntry.table_name}' found. Routing to TechAgent.`);
            route = "TechAgent";
        }
    }

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

    const liveKpiContext = await buildFinanceKpiContext(query);
    if (liveKpiContext) {
        console.log("[Finance Agent] Enriched with live KPI data from Data Lake (MCP tools).");
        context = `${context}\n\n--- Live KPI Data (from database) ---\n${liveKpiContext}`;
    }

    const catalog = await getCatalog();
    if (catalog && catalog.length > 0) {
        const tableList = catalog.map((e: any) => `- ${e.table_name} (${e.description || "N/A"})`).join("\n");
        context = `${context}\n\n--- Available Tables in Data Lake ---\n${tableList}`;
    }

    if (context === "No context available." || !context) {
        console.log("[Finance Agent] No context available — falling through to TechAgent for data query.");
        if (onChunk) onChunk("(Finance Agent → Tech Agent)\nМэдээллийн сангаас дата шүүж байна...\n\n");
        return techAgentNode(state, config);
    }

    const llm = await createLLM({ temperature: 0 });
    if (!llm) {
        const fallback = `(Finance Agent)\nBased on RAG:\n${context}`;
        if (onChunk) onChunk(fallback);
        return {
            messages: [{ role: "assistant", content: fallback }]
        };
    }

    const prefix = "(Finance Agent)\n";
    if (onChunk) onChunk(prefix);

    const financePrompt = prompts.finance_agent;
    const systemPrompt = `${financePrompt}\n\nHere is the retrieved business context:\n${context}`;
    
    const executeMessages = trimMessages([
        { role: "system", content: systemPrompt },
        ...state.messages.map((m: any) => ({ role: m.role, content: m.content }))
    ]);

    try {
        let stream: any;
        try {
            stream = await withTimeout(llm.stream(executeMessages), "Finance agent response");
        } catch (err: any) {
            console.warn("[Finance Agent] Primary LLM failed, attempting fallback to GROQ:", err.message);
            const fallbackLLM = await createLLMWithOrder({ 
                temperature: 0, 
                providerOrder: ["groq", "openai"] 
            });
            if (fallbackLLM) {
                stream = await withTimeout(fallbackLLM.stream(executeMessages), "Finance agent fallback response");
            } else {
                throw err;
            }
        }

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

function generateVisualTag(jsonResults: string): string {
    let data: any[];
    try {
        data = JSON.parse(jsonResults);
    } catch {
        return '';
    }
    if (!Array.isArray(data) || data.length <= 1) return '';
    const keys = Object.keys(data[0]);
    if (keys.length === 0) return '';

    const labelKey = keys.find(k => k.toLowerCase() === 'label') || keys[0];
    const numericKeys = keys.filter(k => k !== labelKey && !isNaN(parseFloat(data[0][k])));
    const valueKey = keys.find(k => k.toLowerCase() === 'value') || (numericKeys.length > 0 ? numericKeys[numericKeys.length - 1] : keys[keys.length - 1]);

    const sampleLabel = String(data[0][labelKey] || '').toLowerCase();
    const timeIndicators = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
        '2020', '2021', '2022', '2023', '2024', '2025', '2026', 'month', 'year', 'date'];
    const isTimeSeries = timeIndicators.some(p => sampleLabel.includes(p) || sampleLabel.startsWith(p))
        || data.some((r: any) => /^\d{4}/.test(String(r[labelKey] || '')));

    const chartType = isTimeSeries ? 'line' : (data.length <= 6 ? 'pie' : 'bar');

    const visualData = data.map((row: any) => ({
        label: String(row[labelKey] ?? ''),
        value: parseFloat(row[valueKey]) || 0
    }));

    const visual = { title: "Дүн шинжилгээ", type: chartType, data: visualData, config: { xAxis: "label", yAxis: "value" } };
    return `<visual>${JSON.stringify(visual)}</visual>`;
}

async function techAgentNode(state: any, config?: any): Promise<Partial<AgentState>> {
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

    if (isPythonQuery(query)) {
        console.log("[Tech Agent] Activated. Running Python via E2B sandbox...");
        const prefix = "(Tech Agent)\nPython код бэлдэж, E2B sandbox-д ажиллуулж байна...\n\n";
        if (onChunk) onChunk(prefix);

        const pythonPrompt = `You are a Python data analyst. Write executable Python 3 code for this task.
Use pandas if reading CSV files (superstore_sales.csv or retail_sales_dataset.csv may exist in the sandbox).
Return ONLY the Python code inside a markdown \`\`\`python block. No explanation outside the block.

Task: ${query}`;

        try {
            const codeGenResponse = await withTimeout(llm.invoke([
                { role: "system", content: pythonPrompt },
                { role: "user", content: query },
            ]), "Tech agent Python generation");

            let rawCode = codeGenResponse.content as string;
            let pythonCode = "";
            if (rawCode.includes("```python")) {
                pythonCode = rawCode.split("```python")[1].split("```")[0].trim();
            } else if (rawCode.includes("```")) {
                pythonCode = rawCode.split("```")[1].split("```")[0].trim();
            } else {
                pythonCode = rawCode.trim();
            }

            const codeBlock = `\`\`\`python\n${pythonCode}\n\`\`\`\n\n`;
            if (onChunk) onChunk(codeBlock);

            const output = await runPythonCode(pythonCode);
            const resultBlock = `### Гүйцэтгэлийн үр дүн\n\`\`\`\n${output}\n\`\`\`\n`;
            if (onChunk) onChunk(resultBlock);

            const explainPrompt = `Summarize the Python execution results for a business user in Mongolian. Be concise.\n\nCode:\n${pythonCode}\n\nOutput:\n${output}`;
            const stream = await withTimeout(llm.stream([
                { role: "system", content: explainPrompt },
                { role: "user", content: query },
            ]), "Tech agent Python explanation");

            let accumulatedText = prefix + codeBlock + resultBlock + "\n";
            if (onChunk) onChunk("\n");
            for await (const chunk of stream) {
                const text = chunk.content as string;
                accumulatedText += text;
                if (onChunk) onChunk(text);
            }

            return { messages: [{ role: "assistant", content: accumulatedText }] };
        } catch (err) {
            const fallback = `${prefix}⚠️ Python ажиллуулахад алдаа гарлаа: ${(err as Error).message}`;
            if (onChunk) onChunk(fallback);
            return { messages: [{ role: "assistant", content: fallback }] };
        }
    }

    console.log("[Tech Agent] Activated. Writing SQL query...");

    // Dashboard designer routing
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes("dashboard") || lowerQuery.includes("ханалтын самбар") || lowerQuery.includes("хана") || lowerQuery.includes("widget") || lowerQuery.includes("вижет")) {
        console.log("[Tech Agent] Dashboard request detected.");
        const dashPrefix = "(Tech Agent)\nDashboard зохиож байна...\n\n";
        if (onChunk) onChunk(dashPrefix);

        const catalog = await getCatalog();
        const mentioned = catalog?.find((e: any) => lowerQuery.includes(e.table_name.toLowerCase()));
        const activeEntry = mentioned || await getActiveCatalogEntry();
        if (!activeEntry) {
            const fallback = `${dashPrefix}⚠️ Идэвхтэй хүснэгт олдсонгүй. Эхлээд өгөгдөл оруулна уу.`;
            if (onChunk) onChunk(fallback);
            return { messages: [{ role: "assistant", content: fallback }] };
        }

        const schema = await buildSchemaDefinition(activeEntry);
        const dashboardPrompt = (prompts.dashboard_designer as string).replace("{schema}", schema);

        try {
            const dashResponse = await withTimeout(llm.invoke([
                { role: "system", content: dashboardPrompt },
                { role: "user", content: `Generate a dashboard for the table: ${activeEntry.table_name}` }
            ]), "Dashboard design");

            const raw = dashResponse.content as string;
            let widgets: any[];
            try {
                const jsonMatch = raw.match(/\[[\s\S]*\]/);
                if (!jsonMatch) throw new Error("No JSON array found in LLM response");
                widgets = JSON.parse(jsonMatch[0]);
            } catch (parseErr) {
                const fallback = `${dashPrefix}⚠️ Dashboard өгөгдлийг боловсруулахад алдаа гарлаа. Анхны хариу:\n\`\`\`json\n${raw}\n\`\`\``;
                if (onChunk) onChunk(fallback);
                return { messages: [{ role: "assistant", content: fallback }] };
            }

            for (const widget of widgets) {
                if (widget.sql) {
                    try {
                        const sqlResult = await handleExecuteSql({ query: widget.sql });
                        if (sqlResult.ok && sqlResult.results) {
                            if (widget.type === "kpi") {
                                widget.value = sqlResult.results[0]?.value ?? null;
                            } else {
                                widget.data = sqlResult.results;
                            }
                        } else {
                            widget.error = sqlResult.text;
                        }
                    } catch (sqlErr) {
                        widget.error = (sqlErr as Error).message;
                    }
                    delete widget.sql;
                }
            }

            const dashboardJson = JSON.stringify(widgets);
            const fullText = `${dashPrefix}<dashboard>${dashboardJson}</dashboard>`;
            if (onChunk) onChunk(fullText);
            return { messages: [{ role: "assistant", content: fullText }] };
        } catch (dashErr) {
            const fallback = `${dashPrefix}⚠️ Dashboard үүсгэхэд алдаа гарлаа: ${(dashErr as Error).message}`;
            if (onChunk) onChunk(fallback);
            return { messages: [{ role: "assistant", content: fallback }] };
        }
    }
    const prefix = "(Tech Agent)\nМэдээллийн сангаас дата шүүж байна... (MCP execute_sql → Data Lake)\n\n";
    if (onChunk) onChunk(prefix);

    console.log(`[Tech Agent] Fetching Data Lake catalog schema...`);
    const schemaContext = await buildActiveSchemaContext(query);
    try {
        console.log(`[Tech Agent] Active schema context:\n${schemaContext}`);
    } catch (err) {
        console.error("[Tech Agent] Schema lookup failed:", err);
    }

    const activeEntry = await getActiveCatalogEntry();
    const deterministicSql = await buildDeterministicTechSql(query, activeEntry);
    if (deterministicSql && activeEntry) {
        try {
            const sqlResult = await handleExecuteSql({ query: deterministicSql });
            if (!sqlResult.ok) throw new Error(sqlResult.text);
            const results = sqlResult.results;
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
    let feedback = "";
    let accumulatedText = prefix;

    while (attempts < MAX_SQL_RETRIES) {
        attempts++;
        console.log(`[Tech Agent] SQL generation attempt ${attempts}/${MAX_SQL_RETRIES}...`);

        if (onChunk && attempts > 1) {
            const warning = `\n*⚠️ Системд алдаа гарлаа. Алдааг автоматаар засварлан дахин ажиллуулж байна (Оролдлого ${attempts}/${MAX_SQL_RETRIES})...*\n`;
            onChunk(warning);
            accumulatedText += warning;
        }

        const sqlGenPrompt = (prompts.tech_agent_sql_gen as string).replace("{catalog}", schemaContext || "(catalog unavailable)");
        let userContent = `Task: ${query}`;
        if (feedback) {
            userContent += `\n\nYour previous SQL query failed with the following error:\n${feedback}\n\nPlease analyze this error and rewrite the SQL query to resolve it. Ensure you only use tables and columns available in the schema provided below. Do not repeat the same incorrect query. IMPORTANT: Never use PostgreSQL function names (TO_DATE, TO_CHAR, EXTRACT, DATE_TRUNC, etc.) as table names, aliases, or CTE names — they will be misinterpreted as table references.\n\n--- Schema ---\n${schemaContext || "(catalog unavailable)"}`;
        }

        try {
            const executeCodeGen = async (model: any) => {
                return await withTimeout(model.invoke([
                    { role: "system", content: sqlGenPrompt },
                    { role: "user", content: userContent }
                ]), "Tech agent SQL generation", SQL_GEN_TIMEOUT_MS);
            };

            let codeGenResponse: any;
            try {
                codeGenResponse = await executeCodeGen(llm);
            } catch (err: any) {
                console.warn("[Tech Agent] Primary LLM for SQL failed, attempting fallback:", err.message);
                const fallbackLLM = await createLLMWithOrder({ temperature: 0, providerOrder: ["gemini", "groq", "openai"] });
                if (fallbackLLM) {
                    codeGenResponse = await executeCodeGen(fallbackLLM);
                } else {
                    throw err;
                }
            }

            const rawCode = (codeGenResponse as any).content as string;
            let currentSql = "";
            if (rawCode.includes("```sql")) {
                currentSql = rawCode.split("```sql")[1].split("```")[0].trim();
            } else if (rawCode.includes("```")) {
                currentSql = rawCode.split("```")[1].split("```")[0].trim();
            } else {
                currentSql = rawCode.trim();
            }

            if (currentSql === sqlCode && attempts > 1) {
                feedback = "Error: The generated SQL is identical to the previous failing one. Please try a different approach or verify the column names.";
                continue;
            }
            sqlCode = currentSql;

            const sqlResult = await handleExecuteSql({ query: sqlCode });
            if (!sqlResult.ok) {
                feedback = sqlResult.text;
                const errorEntry = `\n### Оролдлого ${attempts}\n*Алдаа:* ${sqlResult.text}\n`;
                if (onChunk) onChunk(errorEntry);
                accumulatedText += errorEntry;

                const schemaError = /багана байхгүй|хүснэгт.*байхгүй|Хүснэгт '/i.test(sqlResult.text);
                if (schemaError) {
                    console.log("[Tech Agent] Schema validation error detected — stopping retries.");
                    accumulatedText += `\n💡 Дээрх алдааны шалтгаан: SQL query-д schema-д байхгүй багана/хүснэгт ашигласан.\n`;
                    break;
                }
                continue;
            }
            sandboxResult = sqlResult.text;

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
                    feedback = `Error: The query returned an empty array []. This might mean the filters (WHERE clause) are too restrictive or column names are slightly off. Available tables/columns: ${schemaContext}`;
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
            if (/багана байхгүй|хүснэгт.*байхгүй|Хүснэгт '/i.test(err.message)) {
                console.log("[Tech Agent] Schema validation error in catch — stopping retries.");
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

    const explainSystemPrompt = (prompts.tech_agent_explain as string).replace("{visual_instruction}", "DO NOT generate any <visual> tags. Visualizations will be added automatically after your response.");
    const explainPrompt = `${explainSystemPrompt}\n\n## Execution Log (Last Attempt)\nSQL: ${sqlCode}\nResult: ${sandboxResult}`;

    const explainMessages = trimMessages([
        { role: "system", content: explainPrompt },
        ...state.messages.map((m: any) => ({ role: m.role, content: m.content }))
    ]);

    async function executeExplainWithFallback(messages: any[]) {
        try {
            return await withTimeout(llm!.stream(messages), "Tech agent explanation");
        } catch (err: any) {
            console.warn("[Tech Agent] Primary explanation LLM failed, attempting fallback:", err.message);
            const fallbackLLM = await createLLMWithOrder({ 
                temperature: 0, 
                providerOrder: ["groq", "anthropic", "openai"] 
            });
            if (fallbackLLM) {
                console.log("[Tech Agent] Fallback to GROQ for explanation successful.");
                return await withTimeout(fallbackLLM.stream(messages), "Tech agent fallback explanation");
            }
            throw err;
        }
    }

    try {
        const stream: any = await executeExplainWithFallback(explainMessages);

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

    accumulatedText = accumulatedText.replace(/<visual>[\s\S]*?<\/visual>/g, '');
    const visualTag = generateVisualTag(sandboxResult);
    if (visualTag) {
        accumulatedText += `\n\n${visualTag}`;
        if (onChunk) onChunk(`\n\n${visualTag}`);
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

export async function runMultiAgent(query: string, userRole: UserRole, threadId: string, visualRequest: boolean = false): Promise<string> {
    const config = { configurable: { thread_id: threadId } };
    const result = await multiAgentApp.invoke(
        { messages: [{ role: "user", content: query }], userRole, visualRequest },
        config
    );
    const messages = (result as any).messages as Message[];
    const lastMsg = messages[messages.length - 1];
    return lastMsg?.content ?? "";
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
