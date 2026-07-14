import { createLLM, invokeWithFallback, streamWithFallback } from "../llm-provider.js";
import { getActiveCatalogEntry, buildSchemaDefinition } from "../db/data-lake.js";
import { searchKnowledgeBase, formatRagDocuments } from "../rag.js";
import { handleExecuteSql, isPythonQuery } from "../tools/enterprise-tools.js";
import { prompts } from "./prompts.js";
import { type AgentState, type AgentConfig, buildContextSummary, trimMessages, withTimeout } from "./agentState.js";
import { extractCodeBlock, safeJsonParse } from "../utils.js";
import {
    MAX_SQL_RETRIES,
    SQL_GEN_TIMEOUT_MS,
    isRateLimitError,
    buildActiveSchemaContext,
    buildDeterministicTechSql,
    formatDeterministicTechResponse,
    buildFallbackQuery,
    computeResultStats,
    generateVisualTag,
    logSqlOutcome,
} from "./sqlGeneration.js";
import { createLogger } from "./logger.js";

const log = createLogger("TechAgent");
import { executeTechPythonAgent } from "./pythonExecution.js";
import { buildDashboard } from "./dashboardBuilder.js";

function generateQuerySuggestion(query: string, entry: any): string {
    const lower = query.toLowerCase();
    const suggestions: string[] = [];

    if (/нийт|total|хэд|how many/i.test(lower)) {
        suggestions.push('"Нийт орлого хэд вэ?" — нийт орлого тооцно');
        suggestions.push('"Нийт зарлага хэд вэ?" — нийт зарлага тооцно');
    }
    if (/сараар|monthly|by month/i.test(lower)) {
        suggestions.push('"Сараар орлого харуул" — сар бүрийн орлого');
        suggestions.push('"Сараар зарлага харуул" — сар бүрийн зарлага');
    }
    if (/ангилал|category|задал|breakdown/i.test(lower)) {
        suggestions.push('"Ангилалаар задал" — ангилал бүрийн дүн');
        suggestions.push('"Дэд ангилалаар харуул" — дэд ангилал бүрийн дүн');
    }
    if (/харилцагч|customer|partner/i.test(lower)) {
        suggestions.push('"Харилцагчаар харуул" — харилцагч бүрийн дүн');
    }

    if (suggestions.length > 0) {
        return "\n\n**Зөвлөмж:** " + suggestions.slice(0, 3).join(" | ");
    }
    return "\n\nТа илүү тодорхой асуулт асуугаарай. Жишээ нь: 'нийт орлого', 'сараар харуул', 'ангилалаар задал'.";
}

export async function techAgentNode(state: AgentState, config?: AgentConfig): Promise<Partial<AgentState>> {
    const onChunk = config?.configurable?.onChunk;
    const onEvent = config?.configurable?.onEvent;

    const query = state.sanitizedQuery || (state.messages[state.messages.length - 1]?.content ?? "");
    const userId = state.userId || "system";

    if (onEvent) onEvent({ type: "thinking", step: "analysis", agent: "TechAgent", message: "Analyzing your data query..." });

    const llm = await createLLM({ temperature: 0 });
    if (!llm) {
        const fallback = `(Tech Agent)\n[АНХААР] No LLM API key configured to generate dynamic SQL code.`;
        if (onChunk) onChunk(fallback);
        return {
            messages: [{ role: "assistant", content: fallback }]
        };
    }

    if (isPythonQuery(query)) {
        return await executeTechPythonAgent(llm, query, onChunk, userId);
    }

    log.info("Activated. Writing SQL query...");

    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes("dashboard") || lowerQuery.includes("ханалтын самбар") || lowerQuery.includes("хана") || lowerQuery.includes("widget") || lowerQuery.includes("вижет")) {
        return await buildDashboard(llm, query, userId, onChunk, state.cachedCatalog, state.cachedActiveEntry);
    }

    const prefix = "(Tech Agent)\nМэдээллийн сангаас дата шүүж байна... (MCP execute_sql → Data Lake)\n\n";
    if (onChunk) onChunk(prefix);

    log.info("Fetching Data Lake catalog schema...");
    if (onEvent) onEvent({ type: "thinking", step: "rag", agent: "TechAgent", message: "Loading database schema..." });
    const schemaContext = await buildActiveSchemaContext(query, userId, state.cachedCatalog, state.cachedActiveEntry, state.cachedSchema);
    try {
        log.info(`Active schema context:\n${schemaContext}`);
    } catch (err) {
        log.error("Schema lookup failed:", { error: String(err) });
    }

    // Fetch RAG context for business knowledge (column synonyms, dbt docs, user uploads)
    log.info("Fetching RAG context for query...");
    let ragContext = "";
    try {
        const ragResult = await searchKnowledgeBase(query, "TechAgent", 5, userId);
        const ragDocs = ragResult.documents?.[0] ?? [];
        const ragMetas = ragResult.metadatas?.[0] ?? [];
        if (ragDocs.length > 0) {
            const formatted = formatRagDocuments(ragDocs, ragMetas);
            ragContext = "\n\n## RAG Context (business knowledge, dbt docs, user uploads)\n" + formatted.join("\n\n---\n\n");
        }
    } catch (err) {
        log.warn("RAG search failed:", { error: (err as Error).message });
    }

    const activeEntry = state.cachedActiveEntry || await getActiveCatalogEntry(userId);
    const deterministicSql = await buildDeterministicTechSql(query, activeEntry);
    if (deterministicSql && activeEntry) {
        try {
            if (onEvent) onEvent({ type: "thinking", step: "sql", agent: "TechAgent", message: "Executing query..." });
            const sqlResult = await handleExecuteSql({ query: deterministicSql, userId });
            if (!sqlResult.ok) throw new Error(sqlResult.text);
            const results = sqlResult.results;
            const normalizedResults = Array.isArray(results) ? results : [results];
            const directResponse = formatDeterministicTechResponse(query, deterministicSql, normalizedResults);
            if (onChunk) onChunk("\n\n" + directResponse);
            void logSqlOutcome({ userId, query, outcome: "deterministic_success", tableName: activeEntry?.table_name });
            return {
                messages: [{ content: `${prefix}\n${directResponse}`, role: "assistant" }]
            };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log.warn("Deterministic SQL fallback failed, continuing with LLM:", { error: msg });
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
        log.info(`SQL generation attempt ${attempts}/${MAX_SQL_RETRIES}...`);
        if (onChunk && attempts > 1) {
            const warning = `\n*[АНХААР] Системд алдаа гарлаа. Алдааг автоматаар засварлан дахин ажиллуулж байна (Оролдлого ${attempts}/${MAX_SQL_RETRIES})...*\n`;
            onChunk(warning);
            accumulatedText += warning;
        }

        const sqlGenPrompt = (prompts.tech_agent_sql_gen as string).replace("{catalog}", schemaContext || "(catalog unavailable)") + ragContext;
        let userContent = `Task: ${query}`;
        if (feedback) {
            userContent += `\n\n${(prompts.sql_retry_feedback as string).replace(/\{query\}/g, query).replace(/\{feedback\}/g, feedback).replace(/\{schemaContext\}/g, schemaContext || "(catalog unavailable)")}${ragContext}`;
        }

        try {
            const codeGenResponse = await invokeWithFallback([
                { role: "system", content: sqlGenPrompt },
                { role: "user", content: userContent }
            ], { temperature: 0, timeout: SQL_GEN_TIMEOUT_MS });

            const rawCode = codeGenResponse.content;
            let currentSql = extractCodeBlock(rawCode, "sql");

            if (currentSql === sqlCode && attempts > 1) {
                feedback = "Error: The generated SQL is identical to the previous failing one. Please try a different approach or verify the column names.";
                continue;
            }
            sqlCode = currentSql;

            if (onEvent) onEvent({ type: "thinking", step: "sql", agent: "TechAgent", message: `Executing SQL (attempt ${attempts})...` });
            const sqlResult = await handleExecuteSql({ query: sqlCode, userId });
            if (!sqlResult.ok) {
                feedback = sqlResult.text;
                const errorEntry = `\n### Оролдлого ${attempts}\n*Алдаа:* ${sqlResult.text}\n`;
                if (onChunk) onChunk(errorEntry);
                accumulatedText += errorEntry;

                const schemaError = /багана байхгүй|хүснэгт.*байхгүй|Хүснэгт '/i.test(sqlResult.text);
                if (schemaError) {
                    log.info("Schema validation error detected — stopping retries.");
                    accumulatedText += `\n[ЗӨВЛӨМЖ] Дээрх алдааны шалтгаан: SQL query-д schema-д байхгүй багана/хүснэгт ашигласан.\n`;
                    void logSqlOutcome({ userId, query, outcome: "schema_error", attempts, tableName: activeEntry?.table_name, error: feedback });
                    break;
                }
                continue;
            }
            sandboxResult = sqlResult.text;

            const logEntry = `\n### Оролдлого ${attempts}\n\`\`\`sql\n${sqlCode}\n\`\`\`\n*Үр дүн:*\n\`\`\`json\n${sandboxResult}\n\`\`\`\n`;
            if (onChunk) onChunk(logEntry);
            accumulatedText += logEntry;

            const hasError = sandboxResult.startsWith("SQL Execution Error:");

            if (!hasError) {
                // Self-healing: check if SQL executed but returned no data
                const parsedResults = safeJsonParse(sandboxResult, []);
                const isEmptyResult = Array.isArray(parsedResults.data) && parsedResults.data.length === 0;
                
                if (isEmptyResult && attempts < MAX_SQL_RETRIES) {
                    feedback = prompts.empty_result_feedback as string;
                    log.info("Empty result detected, retrying with self-healing feedback...");
                    continue;
                }
                isSuccess = true;
                break;
            } else {
                feedback = sandboxResult;
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            feedback = msg;
            const errorEntry = `\n### Оролдлого ${attempts}\n*Алдаа:* ${msg}\n`;
            if (onChunk) onChunk(errorEntry);
            accumulatedText += errorEntry;
            if (isRateLimitError(err)) {
                log.warn("LLM rate limit hit, stopping retries early.");
                void logSqlOutcome({ userId, query, outcome: "rate_limit", attempts, tableName: activeEntry?.table_name, error: msg });
                break;
            }
            if (/багана байхгүй|хүснэгт.*байхгүй|Хүснэгт '/i.test(msg)) {
                log.info("Schema validation error in catch — stopping retries.");
                void logSqlOutcome({ userId, query, outcome: "schema_error", attempts, tableName: activeEntry?.table_name, error: msg });
                break;
            }
        }
    }

    if (!isSuccess) {
        const fallbackQuery = buildFallbackQuery(query, activeEntry);
        if (fallbackQuery && activeEntry) {
            try {
                const fbResult = await handleExecuteSql({ query: fallbackQuery, userId });
                if (fbResult.ok && fbResult.results) {
                    const fbData = Array.isArray(fbResult.results) ? fbResult.results : [fbResult.results];
                    if (fbData.length > 0) {
                        sandboxResult = JSON.stringify(fbData);
                        sqlCode = fallbackQuery;
                        isSuccess = true;
                        void logSqlOutcome({ userId, query, outcome: "fallback_success", attempts, tableName: activeEntry?.table_name });
                        const note = `\n### Fallback\n*Тусгай query амжилтгүй, өгөгдлийн сангийн түүвэр мэдээллээр хариулж байна.*\n\n`;
                        if (onChunk) onChunk(note);
                        accumulatedText += note;
                    }
                }
            } catch (fbErr) {
                log.warn("Fallback query failed:", { error: (fbErr as Error).message });
            }
        }
        if (!isSuccess) {
            void logSqlOutcome({ userId, query, outcome: "total_failure", attempts, tableName: activeEntry?.table_name, error: "All SQL generation paths failed" });
            const suggestion = generateQuerySuggestion(query, activeEntry);
            const fallback = `${accumulatedText}\n\n[АНХААР] Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу.${suggestion}`;
            if (onChunk) onChunk(`\n\n[АНХААР] Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу.${suggestion}`);
            return {
                messages: [{ role: "assistant", content: fallback }]
            };
        }
    }

    if (isSuccess && attempts > 0) {
        const outcome: import("./sqlGeneration.js").SqlOutcome = attempts === 1 ? "llm_attempt_1_success" : "llm_attempt_2_success";
        void logSqlOutcome({ userId, query, outcome, attempts, tableName: activeEntry?.table_name });
    }

    const dataStats = computeResultStats(sandboxResult);
    const qualityChecklist = prompts.data_quality_checklist || "";
    const contextSummary = buildContextSummary(state.messages);
    const explainSystemPrompt = (prompts.tech_agent_explain as string)
      .replace("{visual_instruction}", "DO NOT generate any <visual> tags. Visualizations will be added automatically after your response.")
      .replace("{{ data_quality_checklist }}", qualityChecklist);
    const explainPrompt = `${explainSystemPrompt}${contextSummary}\n\n${dataStats}\n\n## Execution Log (Last Attempt)\nSQL: ${sqlCode}\nResult: ${sandboxResult}\n\n## RAG Context\n${ragContext}`;

    const explainMessages = trimMessages([
        { role: "system", content: explainPrompt },
        ...state.messages.map((m) => ({ role: m.role, content: m.content }))
    ]);

    try {
        const { stream } = await streamWithFallback(explainMessages, { temperature: 0, timeout: 60000 });

        if (onChunk) onChunk("\n\n");
        accumulatedText += "\n\n";

        for await (const chunk of stream) {
            const text = chunk.content as string;
            accumulatedText += text;
            if (onChunk) onChunk(text);
        }
    } catch (explainErr) {
        const fallback = `\n\n[АНХААР] Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу. Санал болгох: өгөгдлийн сангийн хүснэгт/баганын нэрээ шалгана уу.`;
        log.warn("Explanation failed:", { error: (explainErr as Error).message });
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
