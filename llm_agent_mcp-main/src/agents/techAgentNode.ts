import { createLLM, createLLMWithOrder } from "../llm-provider.js";
import { getActiveCatalogEntry, buildSchemaDefinition } from "../db/data-lake.js";
import { handleExecuteSql, isPythonQuery } from "../tools/enterprise-tools.js";
import { prompts } from "./prompts.js";
import { type AgentState, buildContextSummary, trimMessages, withTimeout } from "./agentState.js";
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
import { executeTechPythonAgent } from "./pythonExecution.js";
import { buildDashboard } from "./dashboardBuilder.js";

export async function techAgentNode(state: any, config?: any): Promise<Partial<AgentState>> {
    const onChunk = config?.configurable?.onChunk;

    const query = state.sanitizedQuery || (state.messages[state.messages.length - 1]?.content ?? "");
    const userId = state.userId || "system";

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

    console.log("[Tech Agent] Activated. Writing SQL query...");

    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes("dashboard") || lowerQuery.includes("ханалтын самбар") || lowerQuery.includes("хана") || lowerQuery.includes("widget") || lowerQuery.includes("вижет")) {
        return await buildDashboard(llm, query, userId, onChunk, state.cachedCatalog, state.cachedActiveEntry);
    }

    const prefix = "(Tech Agent)\nМэдээллийн сангаас дата шүүж байна... (MCP execute_sql → Data Lake)\n\n";
    if (onChunk) onChunk(prefix);

    console.log(`[Tech Agent] Fetching Data Lake catalog schema...`);
    const schemaContext = await buildActiveSchemaContext(query, userId, state.cachedCatalog, state.cachedActiveEntry, state.cachedSchema);
    try {
        console.log(`[Tech Agent] Active schema context:\n${schemaContext}`);
    } catch (err) {
        console.error("[Tech Agent] Schema lookup failed:", err);
    }

    const activeEntry = state.cachedActiveEntry || await getActiveCatalogEntry(userId);
    const deterministicSql = await buildDeterministicTechSql(query, activeEntry);
    if (deterministicSql && activeEntry) {
        try {
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
            const warning = `\n*[АНХААР] Системд алдаа гарлаа. Алдааг автоматаар засварлан дахин ажиллуулж байна (Оролдлого ${attempts}/${MAX_SQL_RETRIES})...*\n`;
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
                const fallbackLLM = await createLLMWithOrder({ temperature: 0, providerOrder: ["groq", "gemini", "openai"] });
                if (fallbackLLM) {
                    codeGenResponse = await executeCodeGen(fallbackLLM);
                } else {
                    throw err;
                }
            }

            const rawCode = (codeGenResponse as any).content as string;
            let currentSql = extractCodeBlock(rawCode, "sql");

            if (currentSql === sqlCode && attempts > 1) {
                feedback = "Error: The generated SQL is identical to the previous failing one. Please try a different approach or verify the column names.";
                continue;
            }
            sqlCode = currentSql;

            const sqlResult = await handleExecuteSql({ query: sqlCode, userId });
            if (!sqlResult.ok) {
                feedback = sqlResult.text;
                const errorEntry = `\n### Оролдлого ${attempts}\n*Алдаа:* ${sqlResult.text}\n`;
                if (onChunk) onChunk(errorEntry);
                accumulatedText += errorEntry;

                const schemaError = /багана байхгүй|хүснэгт.*байхгүй|Хүснэгт '/i.test(sqlResult.text);
                if (schemaError) {
                    console.log("[Tech Agent] Schema validation error detected — stopping retries.");
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
                    feedback = "The SQL executed successfully but returned 0 rows (empty result). Possible causes: (1) categorical filter value mismatch — check the sample values in the schema and use ILIKE with partial matching instead of exact match (=), (2) date column type may be INT (Excel serial) or TEXT when you assumed DATE/TIMESTAMP — check column types in schema, (3) data may use different capitalization or format. Try using ILIKE with % wildcards, verify date column type conversion, and add fallback conditions.";
                    console.log("[Tech Agent] Empty result detected, retrying with self-healing feedback...");
                    continue;
                }
                isSuccess = true;
                break;
            } else {
                feedback = sandboxResult;
            }
        } catch (err: any) {
            feedback = err.message;
            const errorEntry = `\n### Оролдлого ${attempts}\n*Алдаа:* ${err.message}\n`;
            if (onChunk) onChunk(errorEntry);
            accumulatedText += errorEntry;
            if (isRateLimitError(err)) {
                console.warn("[Tech Agent] LLM rate limit hit, stopping retries early.");
                void logSqlOutcome({ userId, query, outcome: "rate_limit", attempts, tableName: activeEntry?.table_name, error: err.message });
                break;
            }
            if (/багана байхгүй|хүснэгт.*байхгүй|Хүснэгт '/i.test(err.message)) {
                console.log("[Tech Agent] Schema validation error in catch — stopping retries.");
                void logSqlOutcome({ userId, query, outcome: "schema_error", attempts, tableName: activeEntry?.table_name, error: err.message });
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
                console.warn("[Tech Agent] Fallback query failed:", (fbErr as Error).message);
            }
        }
        if (!isSuccess) {
            void logSqlOutcome({ userId, query, outcome: "total_failure", attempts, tableName: activeEntry?.table_name, error: "All SQL generation paths failed" });
            const fallback = `${accumulatedText}\n\n[АНХААР] Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу. Хэрэв та баганын нэр эсвэл хүснэгтийн нэр зааж өгвөл би илүү нарийвчлалтай хариулж чадна.`;
            if (onChunk) onChunk("\n\n[АНХААР] Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу.");
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
    const explainPrompt = `${explainSystemPrompt}${contextSummary}\n\n${dataStats}\n\n## Execution Log (Last Attempt)\nSQL: ${sqlCode}\nResult: ${sandboxResult}`;

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
        const fallback = `\n\n[АНХААР] Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу. Санал болгох: өгөгдлийн сангийн хүснэгт/баганын нэрээ шалгана уу.`;
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
