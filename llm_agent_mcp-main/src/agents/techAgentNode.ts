import { createLLM, createLLMWithOrder } from "../llm-provider.js";
import { getCatalog, getActiveCatalogEntry, buildSchemaDefinition } from "../db/data-lake.js";
import { handleExecuteSql, isPythonQuery } from "../tools/enterprise-tools.js";
import { safeJsonParse, buildSemanticGroups, formatSemanticGroups } from "../utils.js";
import { runPythonCode } from "../sandbox.js";
import { prompts } from "./prompts.js";
import { type AgentState, buildContextSummary, trimMessages, withTimeout } from "./agentState.js";

const MAX_SQL_RETRIES = 2;
const SQL_GEN_TIMEOUT_MS = 55000;

function isRateLimitError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /rate limit|429|tokens per day|TPD|quota exceeded|quota.*limit/i.test(message);
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

async function buildDeterministicTechSql(query: string, entry?: import("../db/data-lake.js").DataLakeCatalogEntry | null): Promise<string | null> {
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

function buildFallbackQuery(query: string, entry?: any): string | null {
    if (!entry) return null;
    const tableName = entry.table_name;
    let columns: string[] = [];
    try { columns = JSON.parse(entry.columns_info) as string[]; } catch { return null; }
    if (columns.length === 0) return null;

    const lowerQuery = query.toLowerCase();
    const hasGrossIncome = columns.some(c => /gross_income/i.test(c));
    const hasIncome = columns.some(c => /income/i.test(c));
    const incomeCol = hasGrossIncome ? "gross_income" : (hasIncome ? "income" : null);

    const isOutlierQuery = /outlier|гажуудал|хэт өндөр|хэт бага|аномали|anomaly|етгээд|стандарт хазайлт|standard deviation|z-score|3σ/i.test(lowerQuery);
    const isIncomeQuery = /gross income|нийт борлуулалт|income|орлого|ашиг/i.test(lowerQuery);

    if (isOutlierQuery && incomeCol) {
        return [
            `SELECT "${incomeCol}", COUNT(*) AS count`,
            `FROM "${tableName}"`,
            `WHERE "${incomeCol}" > (SELECT AVG("${incomeCol}") + 2 * STDDEV("${incomeCol}") FROM "${tableName}")`,
            `   OR "${incomeCol}" < (SELECT AVG("${incomeCol}") - 2 * STDDEV("${incomeCol}") FROM "${tableName}")`,
            `GROUP BY "${incomeCol}"`,
            `ORDER BY "${incomeCol}" DESC`,
            `LIMIT 20;`,
        ].join("\n");
    }

    if (isIncomeQuery && incomeCol) {
        return [
            `SELECT`,
            `  MIN("${incomeCol}") AS min_income,`,
            `  MAX("${incomeCol}") AS max_income,`,
            `  AVG("${incomeCol}") AS avg_income,`,
            `  STDDEV("${incomeCol}") AS std_income,`,
            `  COUNT(*) AS total_rows`,
            `FROM "${tableName}";`,
        ].join("\n");
    }

    const numericCol = columns.find(c => /gross_income|sales|revenue|amount|profit|unit_price|total/i.test(c));
    const dateCol = columns.find(c => /date|time/i.test(c));
    if (dateCol && numericCol) {
        return `SELECT "${dateCol}" AS label, SUM("${numericCol}") AS value FROM "${tableName}" GROUP BY label ORDER BY label DESC LIMIT 10;`;
    }
    if (numericCol) {
        return `SELECT "${numericCol}" AS value FROM "${tableName}" ORDER BY "${numericCol}" DESC LIMIT 10;`;
    }

    const sampleCols = columns.slice(0, 5).map((c: string) => `"${c}"`).join(", ");
    return `SELECT ${sampleCols} FROM "${tableName}" LIMIT 10;`;
}

function computeResultStats(sandboxResult: string): string {
    try {
        const rows = JSON.parse(sandboxResult);
        if (!Array.isArray(rows) || rows.length === 0) return "";
        const numericCols = Object.keys(rows[0]).filter(key => {
            const vals = rows.map((r: any) => Number(r[key])).filter((v: number) => !isNaN(v));
            return vals.length > rows.length * 0.5;
        });
        if (numericCols.length === 0) return "";

        const lines: string[] = [`## Data Statistics (from ${rows.length} rows)`];
        for (const col of numericCols) {
            const vals = rows.map((r: any) => Number(r[col])).filter((v: number) => !isNaN(v));
            if (vals.length === 0) continue;
            const n = vals.length;
            const sorted = [...vals].sort((a, b) => a - b);
            const sum = vals.reduce((a: number, b: number) => a + b, 0);
            const mean = sum / n;
            const min = sorted[0];
            const max = sorted[n - 1];
            const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
            const variance = vals.reduce((sq: number, v: number) => sq + (v - mean) ** 2, 0) / n;
            const std = Math.sqrt(variance);

            const q1 = sorted[Math.floor(n * 0.25)];
            const q3 = sorted[Math.floor(n * 0.75)];
            const iqr = q3 - q1;

            lines.push(`- ${col}: avg=${mean.toFixed(1)}, median=${median.toFixed(1)}, min=${min.toFixed(1)}, max=${max.toFixed(1)}, std=${std.toFixed(1)}, iqr=${iqr.toFixed(1)}, count=${n}`);

            const threeSigmaOutliers = vals.filter((v: number) => Math.abs(v - mean) > 3 * std);
            const iqrOutliers = vals.filter((v: number) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);
            const allOutliers = [...new Set([...threeSigmaOutliers, ...iqrOutliers])];

            if (allOutliers.length > 0) {
                const outlierStr = [...new Set(allOutliers.map((v: number) => v.toFixed(1)))].slice(0, 5).join(", ");
                const pct = ((allOutliers.length / n) * 100).toFixed(1);
                lines.push(`  Outliers in "${col}": ${outlierStr} (${allOutliers.length}/${n} = ${pct}% of rows, 3σ/IQR method)`);
            }
        }
        return lines.length > 1 ? lines.join("\n") : "";
    } catch {
        return "";
    }
}

function generateVisualTag(jsonResults: string): string {
    let data: any[];
    try {
        const { data: parsed } = safeJsonParse<any[]>(jsonResults, []);
        if (!Array.isArray(parsed)) throw new Error("Not an array");
        data = parsed;
    } catch {
        return '';
    }
    if (!Array.isArray(data) || data.length <= 1) return '';
    const keys = Object.keys(data[0]);
    if (keys.length === 0) return '';

    const allNumericKeys = keys.filter(k => {
        return data.some((r: any) => {
            const v = parseFloat(r[k]);
            return !isNaN(v) && isFinite(v);
        });
    });
    const allTextKeys = keys.filter(k => !allNumericKeys.includes(k));

    let labelKey: string;
    let valueKey: string;

    if (keys.find(k => k.toLowerCase() === 'label')) {
        labelKey = keys.find(k => k.toLowerCase() === 'label')!;
        valueKey = keys.find(k => k.toLowerCase() === 'value') || allNumericKeys.find(k => k !== labelKey) || allNumericKeys[0] || keys[keys.length - 1];
    } else if (allNumericKeys.length >= 2) {
        valueKey = allNumericKeys[allNumericKeys.length - 1];
        labelKey = allTextKeys[0] || allNumericKeys[0];
    } else if (allNumericKeys.length === 1) {
        valueKey = allNumericKeys[0];
        labelKey = allTextKeys[0] || valueKey;
    } else {
        labelKey = keys[0];
        valueKey = keys[keys.length - 1];
    }

    const sampleLabel = String(data[0][labelKey] || '').toLowerCase();
    const timeIndicators = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
        '2020', '2021', '2022', '2023', '2024', '2025', '2026', 'month', 'year', 'date'];
    const isTimeSeries = timeIndicators.some(p => sampleLabel.includes(p) || sampleLabel.startsWith(p))
        || data.some((r: any) => /^\d{4}/.test(String(r[labelKey] || '')));

    if (isTimeSeries) {
        const visualData = data.map((row: any) => ({
            label: String(row[labelKey] ?? ''),
            value: parseFloat(row[valueKey]) || 0
        }));
        const visual = { title: "Дүн шинжилгээ", type: "line", data: visualData, config: { xAxis: "label", yAxis: "value" } };
        return `<visual>${JSON.stringify(visual)}</visual>`;
    }

    const allValues = data.map((r: any) => parseFloat(r[valueKey]) || 0);
    const allIntegers = allValues.every(v => Number.isInteger(v) && v >= 0);
    const allSmallInts = allIntegers && allValues.every(v => v <= 1000);
    const isLikelyCounts = allSmallInts && allValues.some(v => v === 0 || v === 1);

    const chartType = (data.length <= 6 && !isLikelyCounts) ? 'pie' : 'bar';

    const visualData = data.map((row: any) => ({
        label: String(row[labelKey] ?? ''),
        value: parseFloat(row[valueKey]) || 0
    }));

    const visual = { title: "Дүн шинжилгээ", type: chartType, data: visualData, config: { xAxis: "label", yAxis: "value" } };
    return `<visual>${JSON.stringify(visual)}</visual>`;
}

export async function techAgentNode(state: any, config?: any): Promise<Partial<AgentState>> {
    const onChunk = config?.configurable?.onChunk;

    const lastMsg = state.messages[state.messages.length - 1];
    const query = lastMsg ? lastMsg.content : "";

    const llm = await createLLM({ temperature: 0 });
    if (!llm) {
        const fallback = `(Tech Agent)\n[АНХААР] No LLM API key configured to generate dynamic SQL code.`;
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
IMPORTANT - Memory safety: NEVER load entire datasets into memory. ALWAYS use df.head(500) or df.sample(500) or pd.read_csv(nrows=1000) to limit data size. The sandbox has limited RAM.
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

            const explainPrompt = `Summarize the Python execution results for a business user in Mongolian. Be concise. Include "Тооцооны аргачлал:" section explaining how numbers were calculated.\n\nCode:\n${pythonCode}\n\nOutput:\n${output}`;
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
            const fallback = `${prefix}[АНХААР] Python ажиллуулахад алдаа гарлаа: ${(err as Error).message}`;
            if (onChunk) onChunk(fallback);
            return { messages: [{ role: "assistant", content: fallback }] };
        }
    }

    console.log("[Tech Agent] Activated. Writing SQL query...");

    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes("dashboard") || lowerQuery.includes("ханалтын самбар") || lowerQuery.includes("хана") || lowerQuery.includes("widget") || lowerQuery.includes("вижет")) {
        console.log("[Tech Agent] Dashboard request detected.");
        const dashPrefix = "(Tech Agent)\nDashboard зохиож байна...\n\n";
        if (onChunk) onChunk(dashPrefix);

        const catalog = await getCatalog();
        const mentioned = catalog?.find((e: any) => lowerQuery.includes(e.table_name.toLowerCase()));
        const activeEntry = mentioned || await getActiveCatalogEntry();
        if (!activeEntry) {
            const fallback = `${dashPrefix}[АНХААР] Идэвхтэй хүснэгт олдсонгүй. Эхлээд зүүн талын Upload хэсгээс CSV файл оруулна уу.`;
            if (onChunk) onChunk(fallback);
            return { messages: [{ role: "assistant", content: fallback }] };
        }

        const schema = await buildSchemaDefinition(activeEntry);
        let columnList: string[] = [];
        try { columnList = JSON.parse(activeEntry.columns_info) as string[]; } catch {}
        const semanticGroups = buildSemanticGroups(columnList);
        const semanticGroupsText = formatSemanticGroups(semanticGroups);
        const dashboardPrompt = (prompts.dashboard_designer as string)
            .replace("{semantic_groups}", semanticGroupsText)
            .replace("{schema}", schema);

        try {
            const dashResponse = await withTimeout(llm.invoke([
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
            const fallback = `${dashPrefix}[АНХААР] Dashboard үүсгэхэд алдаа гарлаа: ${(dashErr as Error).message}`;
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
                    accumulatedText += `\n[ЗӨВЛӨМЖ] Дээрх алдааны шалтгаан: SQL query-д schema-д байхгүй багана/хүснэгт ашигласан.\n`;
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
        const fallbackQuery = buildFallbackQuery(query, activeEntry);
        if (fallbackQuery && activeEntry) {
            try {
                const fbResult = await handleExecuteSql({ query: fallbackQuery });
                if (fbResult.ok && fbResult.results) {
                    const fbData = Array.isArray(fbResult.results) ? fbResult.results : [fbResult.results];
                    if (fbData.length > 0) {
                        sandboxResult = JSON.stringify(fbData);
                        sqlCode = fallbackQuery;
                        isSuccess = true;
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
            const fallback = `${accumulatedText}\n\n[АНХААР] Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу. Хэрэв та баганын нэр эсвэл хүснэгтийн нэр зааж өгвөл би илүү нарийвчлалтай хариулж чадна.`;
            if (onChunk) onChunk("\n\n[АНХААР] Хариу бэлдэхэд саатал гарлаа. Дахин оролдоно уу.");
            return {
                messages: [{ role: "assistant", content: fallback }]
            };
        }
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
