import { createLLM } from "../llm-provider.js";
import { getCatalog, getActiveCatalogEntry, buildSchemaDefinition } from "../db/data-lake.js";
import { handleExecuteSql } from "../tools/enterprise-tools.js";
import { safeJsonParse, buildSemanticGroups, formatSemanticGroups, queryMentionsTable } from "../utils.js";
import { prompts } from "./prompts.js";
import { type AgentState, withTimeout } from "./agentState.js";

export async function buildDashboard(
    llm: any,
    query: string,
    userId: string,
    onChunk?: (chunk: string) => void,
    cachedCatalog?: any[],
    cachedActiveEntry?: any
): Promise<Partial<AgentState>> {
    console.log("[Tech Agent] Dashboard request detected.");
    const dashPrefix = "(Tech Agent)\nDashboard зохиож байна...\n\n";
    if (onChunk) onChunk(dashPrefix);

    const catalog = cachedCatalog || await getCatalog(userId);
    const lowerQuery = query.toLowerCase();
    const mentioned = catalog?.find((e: any) => queryMentionsTable(query, e.table_name));
    const activeEntry = mentioned || cachedActiveEntry || await getActiveCatalogEntry(userId);
    if (!activeEntry) {
        const fallback = `${dashPrefix}[АНХААР] Идэвхтэй хүснэгт олдсонгүй. Эхлээд зүүн талын Upload хэсгээс CSV файл оруулна уу.`;
        if (onChunk) onChunk(fallback);
        return { messages: [{ role: "assistant", content: fallback }] };
    }

    const schema = await buildSchemaDefinition(activeEntry);
    let columnList: string[] = [];
    try { columnList = JSON.parse(activeEntry.columns_info) as string[]; } catch (e) {
        console.error("[DashboardBuilder] Failed to parse columns_info:", e);
    }
    const semanticGroups = buildSemanticGroups(columnList);
    const semanticGroupsText = formatSemanticGroups(semanticGroups);
    const dashboardPrompt = (prompts.dashboard_designer as string)
        .replace("{semantic_groups}", semanticGroupsText)
        .replace("{schema}", schema);

    try {
        const dashResponse: any = await withTimeout(llm.invoke([
            { role: "system", content: dashboardPrompt },
            { role: "user", content: `Generate a dashboard for the table: ${activeEntry.table_name}` }
        ]), "Dashboard design");

        const raw = dashResponse.content as string;
        let widgets: any[];
        try {
            const { data, cleaned } = safeJsonParse<any[]>(raw, []);
            if (!Array.isArray(data) || data.length === 0) throw new Error("No valid JSON array found");
            widgets = data;
        } catch (parseErr) {
            const fallback = `${dashPrefix}[АНХААР] Dashboard өгөгдлийг боловсруулахад алдаа гарлаа. Анхны хариу:\n\`\`\`json\n${raw}\n\`\`\``;
            if (onChunk) onChunk(fallback);
            return { messages: [{ role: "assistant", content: fallback }] };
        }

        for (const widget of widgets) {
            if (widget.sql) {
                try {
                    const sqlResult = await handleExecuteSql({ query: widget.sql, userId });
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
        const fallback = `${dashPrefix}[АНХААР] Dashboard үүсгэхэд алдаа гарлаа: ${(dashErr as Error).message}`;
        if (onChunk) onChunk(fallback);
        return { messages: [{ role: "assistant", content: fallback }] };
    }
}
