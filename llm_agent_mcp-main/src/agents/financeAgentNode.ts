import { createLLM, invokeWithFallback, streamWithFallback } from "../llm-provider.js";
import { selfQueryTransform, searchKnowledgeBase, searchKnowledgeBaseWithFilter } from "../rag.js";
import { buildFinanceKpiContext } from "../tools/enterprise-tools.js";
import { getCatalog, getActiveCatalogEntry, buildSchemaDefinition } from "../db/data-lake.js";
import { prompts } from "./prompts.js";
import { type AgentState, type AgentConfig, buildContextSummary, trimMessages, withTimeout } from "./agentState.js";
import { techAgentNode } from "./techAgentNode.js";
import { createLogger } from "./logger.js";

const log = createLogger("FinanceAgent");

export async function financeAgentNode(state: AgentState, config?: AgentConfig): Promise<Partial<AgentState>> {
    log.info("Activated.");
    const onChunk = config?.configurable?.onChunk;
    const onEvent = config?.configurable?.onEvent;

    const query = state.sanitizedQuery || (state.messages[state.messages.length - 1]?.content ?? "");
    const userId = state.userId || "system";

    if (onEvent) onEvent({ type: "thinking", step: "analysis", agent: "FinanceAgent", message: "Analyzing your financial question..." });

    // ── 1-рт: Data query эсэхийг шалгах (RAG context-аас хамаарахгүй) ──
    const isDataQuery = /\b(sql|query|select|хүснэгт|багана|өгөгдөл|дата|row|мөр|column)\b/i.test(query)
        || /\b(how many|хэд|нийт|total|count|sum|average|дундаж|нийлбэр|орлого|зарлага)\b/i.test(query);

    if (isDataQuery) {
        log.info("Data query detected — delegating to TechAgent (bypassing RAG).");
        if (onEvent) onEvent({ type: "thinking", step: "delegation", agent: "TechAgent", message: "Data query — delegating to TechAgent" });
        if (onChunk) onChunk("(Finance Agent → Tech Agent)\nМэдээллийн сангаас дата шүүж байна...\n\n");
        return techAgentNode(state, config);
    }

    const llm = await createLLM({ temperature: 0 });

    log.info(`Fetching RAG context for query: "${query}"`);
    if (onEvent) onEvent({ type: "thinking", step: "rag", agent: "FinanceAgent", message: "Searching knowledge base..." });
    let context = "No context available.";
    try {
        let filter;
        if (llm) {
            try {
                filter = await selfQueryTransform(query, (prompt: string) =>
                    invokeWithFallback([
                        { role: "system", content: prompt },
                        { role: "user", content: query }
                    ], { temperature: 0, timeout: 30000 }).then((r) => r.content)
                );
                log.info("Self-query filter applied", { filter: JSON.stringify(filter) });
            } catch (sqErr) {
                log.warn("Self-query failed, using plain search:", { error: (sqErr as Error).message });
            }
        }

        const ragData = filter
            ? await searchKnowledgeBaseWithFilter({ query: filter.query || query, agentRole: "FinanceAgent", limit: 5, filter, userId: state.userId })
            : await searchKnowledgeBase(query, "FinanceAgent", 5, state.userId);
        const docs = ragData.documents?.[0] ?? [];
        if (docs.length > 0) {
            context = docs.join("\n\n---\n\n");
        } else {
            log.warn("RAG returned no documents.");
        }
    } catch (err) {
        log.error("RAG search failed:", { error: String(err) });
    }

    const liveKpiContext = await buildFinanceKpiContext(query);
    if (liveKpiContext) {
        log.info("Enriched with live KPI data from Data Lake (MCP tools).");
        context = `${context}\n\n--- Live KPI Data (from database) ---\n${liveKpiContext}`;
    }

    const catalog = state.cachedCatalog || await getCatalog(userId);
    if (catalog && catalog.length > 0) {
        const tableList = catalog.map((e) => `- ${e.table_name} (${e.description || "N/A"})`).join("\n");
        context = `${context}\n\n--- Available Tables in Data Lake ---\n${tableList}`;
    }

    // Add user's uploaded data schema and sample for better SQL generation
    const activeEntry = state.cachedActiveEntry || await getActiveCatalogEntry(userId);
    if (activeEntry) {
        const schema = state.cachedSchema || await buildSchemaDefinition(activeEntry).catch(() => "");
        if (schema) {
            context = `${context}\n\n--- Active Dataset Schema (${activeEntry.table_name}) ---\n${schema}`;
        }
    }

    if (context === "No context available." || !context) {
        log.info("No RAG context — answering from LLM knowledge (conceptual finance question).");
    }

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
    const qualityChecklistFinance = prompts.data_quality_checklist || "";
    const contextSummary = buildContextSummary(state.messages);
    const systemPrompt = `${financePrompt}\n\n${qualityChecklistFinance}${contextSummary}\n\nHere is the retrieved business context:\n${context}`;

    const executeMessages = trimMessages([
        { role: "system", content: systemPrompt },
        ...state.messages.map((m) => ({ role: m.role, content: m.content }))
    ]);

    try {
        const { stream } = await streamWithFallback(executeMessages, { temperature: 0, timeout: 60000 });

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
        const fallbackText = `${prefix}[АНХААР] Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу.`;
        log.warn("Response failed:", { error: (streamErr as Error).message });
        if (onChunk) onChunk(fallbackText);
        return {
            messages: [{ role: "assistant", content: fallbackText }]
        };
    }
}
