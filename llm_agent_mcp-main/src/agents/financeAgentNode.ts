import { createLLM, createLLMWithOrder } from "../llm-provider.js";
import { selfQueryTransform, searchKnowledgeBase, searchKnowledgeBaseWithFilter } from "../rag.js";
import { buildFinanceKpiContext } from "../tools/enterprise-tools.js";
import { getCatalog } from "../db/data-lake.js";
import { prompts } from "./prompts.js";
import { type AgentState, buildContextSummary, trimMessages, withTimeout } from "./agentState.js";
import { techAgentNode } from "./techAgentNode.js";

export async function financeAgentNode(state: any, config?: any): Promise<Partial<AgentState>> {
    console.log("[Finance Agent] Activated.");
    const onChunk = config?.configurable?.onChunk;

    const query = state.sanitizedQuery || (state.messages[state.messages.length - 1]?.content ?? "");
    const userId = state.userId || "system";

    const llm = await createLLM({ temperature: 0 });

    console.log(`[Finance Agent] Fetching RAG context for query: "${query}"`);
    let context = "No context available.";
    try {
        let filter;
        if (llm) {
            try {
                const structuredLlm = (llm as any).withStructuredOutput
                    ? llm
                    : await createLLMWithOrder({ temperature: 0, providerOrder: ["groq", "gemini"] });
                if (structuredLlm) {
                    filter = await selfQueryTransform(query, (prompt: string) =>
                        structuredLlm.invoke([
                            { role: "system", content: prompt },
                            { role: "user", content: query }
                        ]).then((r: any) => r.content as string)
                    );
                    console.log(`[Finance Agent] Self-query filter: ${JSON.stringify(filter)}`);
                }
            } catch (sqErr) {
                console.warn("[Finance Agent] Self-query failed, using plain search:", (sqErr as Error).message);
            }
        }

        const ragData = filter
            ? await searchKnowledgeBaseWithFilter({ query: filter.query || query, agentRole: "FinanceAgent", limit: 5, filter, userId: state.userId })
            : await searchKnowledgeBase(query, "FinanceAgent", 5, state.userId);
        const docs = ragData.documents?.[0] ?? [];
        if (docs.length > 0) {
            context = docs.join("\n\n---\n\n");
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

    const catalog = state.cachedCatalog || await getCatalog(userId);
    if (catalog && catalog.length > 0) {
        const tableList = catalog.map((e: any) => `- ${e.table_name} (${e.description || "N/A"})`).join("\n");
        context = `${context}\n\n--- Available Tables in Data Lake ---\n${tableList}`;
    }

    if (context === "No context available." || !context) {
        console.log("[Finance Agent] No context available — falling through to TechAgent for data query.");
        if (onChunk) onChunk("(Finance Agent → Tech Agent)\nМэдээллийн сангаас дата шүүж байна...\n\n");
        return techAgentNode(state, config);
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
        const fallbackText = `${prefix}[АНХААР] Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу.`;
        console.warn("[Finance Agent] Response failed:", (streamErr as Error).message);
        if (onChunk) onChunk(fallbackText);
        return {
            messages: [{ role: "assistant", content: fallbackText }]
        };
    }
}
