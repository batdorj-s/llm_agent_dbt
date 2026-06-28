import { createLLM } from "../llm-provider.js";
import { getCatalog, getActiveCatalogEntry } from "../db/data-lake.js";
import { prompts } from "./prompts.js";
import { trimMessages, withTimeout, type AgentState, type NextAgent } from "./agentState.js";
import { queryMentionsTable } from "../utils.js";
import { z } from "zod";
import { sanitizeUserInput } from "./sanitize.js";

const RouteSchema = z.object({
    route: z.enum(["FinanceAgent", "TechAgent", "DataScientistAgent", "END"])
        .describe("Which agent to route to. FinanceAgent for business/financial queries, TechAgent for coding/data/math, DataScientistAgent for forecasting/trends/clustering/statistics, END otherwise."),
    reason: z.string().describe("One sentence explaining the routing decision.")
});

export const TECH_SIGNALS = [
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
export const DATA_SCIENCE_SIGNALS = [
    "таамагла", "forecast", "predict", "ирээдүй", "дараагийн", "урьдчилан",
    "хандлага", "trend analysis", "seasonal", "seasonality",
    "бүлэглэлт", "cluster", "customer segmentation", "сегментчилэл",
    "корреляци", "correlation", "хамаарал", "нөлөөлөл",
    "regression", "регресс", "linear model", "machine learning",
    "anova", "t-test", "chi-square", "hypothesis", "статистик тест",
    "outlier detection", "гажуудал илрүүлэх", "anomaly",
    "prophet", "arima", "time series", "хугацааны цуваа",
    "k-means", "kmeans", "pca", "dimension reduction",
    "feature importance", "coefficient", "р square", "r-squared",
    "deep learning", "нейрон", "neural",
];
export const FINANCE_SIGNALS = [
    "sales target", "revenue target", "profit target", "margin target", "kpi", "kpi target",
    "борлуулалтын төлөвлөгөө", "орлогын төлөвлөгөө", "ашгийн төлөвлөгөө",
];

export function hasSignal(text: string, signal: string): boolean {
    if (/^[a-zA-Z0-9_.\-+]+$/.test(signal)) {
        const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
    }
    return text.includes(signal);
}

export function routeByKeywords(query: string, hasActiveDataset: boolean, mentionsKnownTable?: boolean): NextAgent {
    const lower = query.toLowerCase();
    const hasTech = TECH_SIGNALS.some((word) => hasSignal(lower, word)) || !!mentionsKnownTable;
    const hasDataScience = DATA_SCIENCE_SIGNALS.some((word) => hasSignal(lower, word));
    const hasFinance = FINANCE_SIGNALS.some((word) => hasSignal(lower, word));

    if (hasDataScience) return "DataScientistAgent";
    if (hasFinance) return "FinanceAgent";
    if (hasTech) return "TechAgent";
    if (hasActiveDataset) return "TechAgent";
    return "END";
}

export async function supervisorNode(state: any, config?: any): Promise<Partial<AgentState>> {
    const lastMsg = state.messages[state.messages.length - 1];
    if (!lastMsg) return { nextAgent: "END" };

    const lastMessage = sanitizeUserInput(lastMsg.content);
    const userId = state.userId || "system";
    console.log(`[Supervisor] Analyzing query: "${lastMessage}"`);

    const systemPrompt = prompts.supervisor;
    const onChunk = config?.configurable?.onChunk;

    const catalog = state.cachedCatalog || await getCatalog(userId);
    const mentionsKnownTable = catalog.some((row: any) => queryMentionsTable(lastMessage, row.table_name));

    const immediateRoute = routeByKeywords(lastMessage, false, mentionsKnownTable);
    if (immediateRoute !== "END") {
        console.log(`[Supervisor] Immediate keyword route -> ${immediateRoute}`);
        return { nextAgent: immediateRoute, sanitizedQuery: lastMessage };
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
                const hasActive = !!state.cachedSchema || !!(await getActiveCatalogEntry(userId));
                if (hasActive) {
                    console.log(`[Supervisor] LLM routed to END but active dataset found. Overriding to TechAgent.`);
                    return { nextAgent: "TechAgent", sanitizedQuery: lastMessage };
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
                        messages: [{ role: "assistant", content: fullText }],
                        sanitizedQuery: lastMessage,
                    };
                } catch (streamErr) {
                    const fallback = "Сайн байна уу! Би байгууллагын AI зохицуулагч байна. Одоогоор хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу.";
                    console.warn("[Supervisor] End response failed:", (streamErr as Error).message);
                    if (onChunk) onChunk(fallback);
                    return {
                        nextAgent: "END",
                        messages: [{ role: "assistant", content: fallback }],
                        sanitizedQuery: lastMessage,
                    };
                }
            }

            return { nextAgent: result.route, sanitizedQuery: lastMessage };
        } catch (err) {
            console.warn("[Supervisor] LLM routing failed, using keyword fallback:", (err as Error).message);
        }
    } else {
        console.log("[Supervisor] No LLM API key — using keyword routing fallback.");
    }

    const activeEntry = state.cachedActiveEntry || await getActiveCatalogEntry(userId);
    let route: NextAgent = routeByKeywords(lastMessage, !!activeEntry, mentionsKnownTable);
    console.log(`[Supervisor] Keyword routed to -> ${route}`);

    if (route === "END") {
        const text = "Сайн байна уу! Би байгууллагын AI зохицуулагч байна. Би танд санхүүгийн асуултууд, борлуулалтын KPI болон код ажиллуулах даалгавар өгөхөд тусалж чадна.\n\nТа дараах зүйлсийг асууж болно:\n- **Борлуулалтын тайлан** — KPI үзүүлэлт, орлого, зорилт\n- **Өгөгдлийн шинжилгээ** — SQL query, тооцоолол, график\n- **Таамаглал** — Forecast, сегментчлэл, корреляци\n\nЭсвэл дээрх файл оруулах хэсгээр CSV өгөгдлөө upload хийгээрэй.";
        if (onChunk) onChunk(text);
        return {
            nextAgent: "END",
            messages: [{ role: "assistant", content: text }],
            sanitizedQuery: lastMessage,
        };
    }
    return { nextAgent: route, sanitizedQuery: lastMessage };
}
