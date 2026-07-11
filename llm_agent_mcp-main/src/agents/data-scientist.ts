import { createLLM, invokeWithFallback } from "../llm-provider.js";
import { getActiveCatalogEntry, buildSchemaDefinition } from "../db/data-lake.js";
import { handleExecuteSql } from "../tools/enterprise-tools.js";
import { runPythonCode } from "../sandbox.js";
import { sandboxLimiter } from "../rate-limiter.js";
import { searchKnowledgeBase } from "../rag.js";
import { selfQueryTransform, searchKnowledgeBaseWithFilter } from "../rag.js";
import { detectDateColumn, extractProfileFromSchemaDef } from "./dateColumnHelper.js";
import { type AgentState, type AgentConfig, withTimeout } from "./agentState.js";
import { computeAllStats } from "./statistics.js";
import { createLogger } from "./logger.js";

const log = createLogger("DataScientist");
import { extractCodeBlock } from "../utils.js";
import { prompts } from "./prompts.js";

const LLM_TIMEOUT_MS = 40000;
const PYTHON_GEN_TIMEOUT_MS = 55000;

export async function dataScientistNode(state: AgentState, config?: AgentConfig): Promise<Partial<AgentState>> {
    const onChunk = config?.configurable?.onChunk;
    const query = state.sanitizedQuery || (state.messages[state.messages.length - 1]?.content ?? "");
    const userId = state.userId || "system";

    const prefix = "(Data Scientist Agent)\nӨгөгдөлд шинжилгээ хийж байна...\n\n";
    if (onChunk) onChunk(prefix);

    const activeEntry = state.cachedActiveEntry || await getActiveCatalogEntry(userId);
    if (!activeEntry) {
        const fallback = `${prefix}[АНХААР] Идэвхтэй хүснэгт олдсонгүй. Зүүн талын Upload хэсгээс CSV файл оруулна уу.`;
        if (onChunk) onChunk(fallback);
        return { messages: [{ role: "assistant", content: fallback }] };
    }

    const schemaDef = state.cachedSchema || await buildSchemaDefinition(activeEntry);
    const tableName = activeEntry.table_name;
    let columnList: string[] = [];
    try {
        columnList = JSON.parse(activeEntry.columns_info) as string[];
    } catch (e) {
        log.error("Failed to parse columns_info:", { error: String(e) });
    }

    log.info(`Active table: ${tableName}`, { columns: columnList.join(", ") });
    const llm = await createLLM({ temperature: 0 });

    let ragContext = "";
    try {
        let filter;
        if (llm) {
            try {
                filter = await selfQueryTransform(query, (prompt: string) =>
                    llm.invoke([
                        { role: "system", content: prompt },
                        { role: "user", content: query }
                    ]).then((r: any) => r.content as string)
                );
                log.info("Self-query filter applied", { filter: JSON.stringify(filter) });            } catch (sqErr) {
                log.warn("Self-query failed:", { error: (sqErr as Error).message });
            }
        }
        const ragData = filter
            ? await searchKnowledgeBaseWithFilter({ query: filter.query || query, agentRole: "DataScientistAgent", limit: 4, filter, userId: state.userId })
            : await searchKnowledgeBase(query, "DataScientistAgent", 4, state.userId);
        const docs = ragData.documents?.[0] ?? [];
        if (docs.length > 0) {
            ragContext = "\n\n## Relevant Knowledge\n" + docs.join("\n\n---\n\n");
            log.info(`Enriched with ${docs.length} RAG docs`);        }
    } catch (err) {
        log.warn("RAG fetch failed:", { error: (err as Error).message });
    }

    if (!llm) {
        const fallback = `${prefix}[АНХААР] LLM API key тохируулаагүй байна.`;
        if (onChunk) onChunk(fallback);
        return { messages: [{ role: "assistant", content: fallback }] };
    }

    const lowerQuery = query.toLowerCase();
    const isForecast = /таамагла|forecast|predict|ирээдүй|хандлага|trend|дараагийн|урьдчилан/i.test(lowerQuery);
    const isCluster = /бүлэгл|cluster|segment|сегментчил/i.test(lowerQuery);
    const isCorrelation = /корреляци|correlation|хамаарал|нөлөөл/i.test(lowerQuery);
    const isRegression = /regression|регресс/i.test(lowerQuery);

    let analysisType = "general";
    if (isForecast) analysisType = "forecast";
    else if (isCluster) analysisType = "cluster";
    else if (isCorrelation) analysisType = "correlation";
    else if (isRegression) analysisType = "regression";

    log.info(`Analysis type detected: ${analysisType}`);
    const columnTypes = parseColumnTypes(schemaDef);
    const dateCol = findDateColumn(columnList, columnTypes);
    const dateColType = dateCol ? (columnTypes[dateCol] || "unknown") : null;
    const numericCols = findNumericColumns(columnList);
    const categoryCols = findCategoryColumns(columnList);

    let sampleData: any[] = [];
    let exportCsvSql: string | null = null;

    let forecastDimension: string | null = null;
    try {
        if (isForecast && dateCol) {
            const aggCol = numericCols[0] || columnList[0];
            const profile = extractProfileFromSchemaDef(schemaDef, dateCol);
            const dateInfo = detectDateColumn(dateCol, dateColType || "unknown", profile ?? undefined);
            const dateCast = dateInfo?.sqlCast ?? (dateColType === "INT"
                ? `'1899-12-30'::date + "${dateCol}"::integer`
                : `CAST("${dateCol}" AS DATE)`);

            // Detect if query asks for per-dimension forecast
            // Negative lookahead prevents false positives from longer words
            // e.g. "бүрээр" in "бүрээрээ" or "салбараар" in "салбараараа"
            const isPerDimension = /тус\s*бүр|бүрээр(?![а-яөүё])|бүтээгдэхүүнээр(?![а-яөүё])|region.?аар|категори.?аар|салбараар(?![а-яөүё])|per\s+(product|region|category)|each\s+(product|region|category)/i.test(lowerQuery);
            let dimensionCol: string | null = null;
            if (isPerDimension && categoryCols.length > 0) {
                dimensionCol = categoryCols[0];
                forecastDimension = dimensionCol;
                log.info(`Per-dimension forecast using: ${dimensionCol}`);
            }

            const dimensionSelect = dimensionCol ? `, "${dimensionCol}" AS dimension` : "";
            const dimensionGroupBy = dimensionCol ? `, "${dimensionCol}"` : "";
            const dimensionOrderBy = dimensionCol ? `, "${dimensionCol}"` : "";
            const forecastSql = `SELECT ${dateCast} AS period${dimensionSelect}, SUM(COALESCE("${aggCol}", 0)) AS value FROM "${tableName}" GROUP BY period${dimensionGroupBy} ORDER BY period${dimensionOrderBy}`;
            log.info(`Forecast mode: ${dateCol}`, { type: dateColType, castAs: dateCast });            const aggResult = await handleExecuteSql({ query: forecastSql, userId });
            if (aggResult.ok && aggResult.results) {
                sampleData = Array.isArray(aggResult.results) ? aggResult.results : [aggResult.results];
                exportCsvSql = forecastSql;
                log.info(`Forecast data: ${sampleData.length} aggregated rows`);            }
        }

        if (sampleData.length === 0) {
            const samplingSql = buildSamplingSql(tableName, columnList);
            const sampleResult = await handleExecuteSql({ query: samplingSql, userId });
            if (sampleResult.ok && sampleResult.results) {
                sampleData = Array.isArray(sampleResult.results) ? sampleResult.results : [sampleResult.results];
            }
            exportCsvSql = buildExportSql(tableName, columnList);
        }
    } catch (err) {
        log.warn("Data fetch failed:", { error: (err as Error).message });
    }

    const statsResult = computeAllStats(sampleData, numericCols, 0);
    let statsSummary = `## Data Statistics (Pre-computed)\n${statsResult.lines.join("\n")}`;
    if (statsResult.outlierLines.length > 0) {
        statsSummary += "\n\n### Detected Outliers (>3σ or IQR)\n" + statsResult.outlierLines.join("\n");
    }
    if (statsResult.lines.length === 0) {
        statsSummary = sampleData.length > 0 ? `${sampleData.length} rows loaded. No numeric columns detected for statistical summary.` : "No data available for statistics.";
    }
    const pythonSystemPrompt = buildPythonPrompt(
        analysisType, tableName, columnList,
        dateCol, dateColType, numericCols, categoryCols,
        schemaDef, sampleData, ragContext, statsSummary,
        forecastDimension
    );

    try {
        const limiterKey = config?.configurable?.threadId || "data-scientist-global";
        const limiterResult = await sandboxLimiter.check(limiterKey);
        if (!limiterResult.allowed) {
            const waitMsg = `\n[АНХААР] Шинжилгээний хязгаарт хүрлээ. ${Math.ceil(limiterResult.resetInMs / 1000)} секунд хүлээнэ үү.\n`;
            if (onChunk) onChunk(waitMsg);
            const fallback = `${prefix}${waitMsg}`;
            return { messages: [{ role: "assistant", content: fallback }] };
        }

        if (onChunk) onChunk(`\n*Python код бэлдэж байна...*\n`);

        const llmResult = await invokeWithFallback(
            [
                { role: "system", content: pythonSystemPrompt },
                { role: "user", content: query }
            ],
            {
                temperature: 0,
                timeout: PYTHON_GEN_TIMEOUT_MS,
                providerOrder: ["groq", "gemini", "openai"]
            }
        );
        // AllProvidersExhaustedError is thrown by invokeWithFallback — propagates to outer catch block

        let rawCode = llmResult.content;
        let pythonCode = extractCodeBlock(rawCode, "python");

        const codeBlock = `\`\`\`python\n${pythonCode}\n\`\`\`\n\n`;
        if (onChunk) onChunk(codeBlock);

        const output = await runPythonCode(pythonCode, undefined, true, userId);

        let cleanOutput = output;
        let chartTag = "";
        const chartMatch = output.match(/##BASE64_IMAGE:([A-Za-z0-9+/=]+)/);
        if (chartMatch) {
            const base64 = chartMatch[1];
            chartTag = `\n\n<img src="data:image/png;base64,${base64}" alt="Analysis Chart" style="max-width:100%; border-radius:8px; margin:12px 0;" />\n`;
            cleanOutput = output.replace(/##CHART_SAVED##\n?/, "").replace(/##BASE64_IMAGE:[A-Za-z0-9+/=]+\n?/, "");
        }

        const resultBlock = `### Гүйцэтгэлийн үр дүн\n\`\`\`\n${cleanOutput}\n\`\`\`\n`;
        if (onChunk) onChunk(resultBlock);

        const explainPrompt = (prompts.data_scientist_explain as string)
            .replace(/\{analysisType\}/g, analysisType)
            .replace(/\{query\}/g, query)
            .replace(/\{pythonCode\}/g, pythonCode)
            .replace(/\{output\}/g, output);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stream: any = await withTimeout((llm as any).stream([
            { role: "system", content: explainPrompt },
            { role: "user", content: query },
        ]), "DataScientist explanation");

        let accumulatedText = prefix + codeBlock + resultBlock + "\n";
        if (chartTag) {
            accumulatedText += chartTag + "\n";
            if (onChunk) onChunk(chartTag + "\n");
        }
        if (onChunk) onChunk("\n");
        for await (const chunk of stream) {
            const text = chunk.content as string;
            accumulatedText += text;
            if (onChunk) onChunk(text);
        }

        return { messages: [{ role: "assistant", content: accumulatedText }] };
    } catch (err) {
        const fallback = `${prefix}[АНХААР] Шинжилгээ хийхэд алдаа гарлаа: ${(err as Error).message}`;
        if (onChunk) onChunk(fallback);
        return { messages: [{ role: "assistant", content: fallback }] };
    }
}

function buildSamplingSql(tableName: string, columns: string[]): string {
    const safeCols = columns.map(c => `"${c}"`).join(", ");
    return `SELECT ${safeCols} FROM "${tableName}" LIMIT 500;`;
}

function buildExportSql(tableName: string, columns: string[]): string {
    const safeCols = columns.map(c => `"${c}"`).join(", ");
    return `SELECT ${safeCols} FROM "${tableName}" LIMIT 3000;`;
}

function findDateColumn(columns: string[], columnTypes?: Record<string, string>): string | null {
    const datePatterns = [/date/i, /time/i, /month/i, /year/i, /timestamp/i, /day/i, /order_date/i, /invoice/i];
    for (const col of columns) {
        const type = columnTypes?.[col];
        if (type?.toUpperCase() === "DATE" || type?.toUpperCase() === "TIMESTAMP") return col;
        for (const pat of datePatterns) {
            if (pat.test(col)) return col;
        }
    }
    return null;
}

function parseColumnTypes(schemaDef: string): Record<string, string> {
    const types: Record<string, string> = {};
    const lines = schemaDef.split("\n");
    for (const line of lines) {
        const match = line.match(/^-\s+(\w+)\s+\((\w+),/);
        if (match) {
            types[match[1]] = match[2];
        }
    }
    return types;
}

function findNumericColumns(columns: string[]): string[] {
    const numericKeywords = [/age/i, /amount/i, /balance/i, /price/i, /cost/i, /revenue/i, /sales/i,
        /income/i, /profit/i, /spend/i, /value/i, /quantity/i, /count/i, /rate/i, /score/i,
        /duration/i, /length/i, /size/i, /total/i, /sum/i, /avg/i, /num/i,
        /rating/i, /үнэлгээ/i, /зардал/i, /орлого/i];
    return columns.filter(col => numericKeywords.some(p => p.test(col)));
}

function findCategoryColumns(columns: string[]): string[] {
    const categoryKeywords = [/category/i, /type/i, /status/i, /segment/i, /group/i, /class/i,
        /region/i, /city/i, /country/i, /state/i, /gender/i, /education/i, /job/i,
        /marital/i, /deposit/i, /loan/i, /default/i, /housing/i, /contact/i, /poutcome/i,
        /channel/i, /campaign/i, /product/i, /item/i, /brand/i, /model/i,
        /branch/i, /салбар/i, /бүтээгдэхүүн/i, /хот/i, /хүйс/i];
    return columns.filter(col => categoryKeywords.some(p => p.test(col)));
}

function buildPythonPrompt(
    analysisType: string, tableName: string, columns: string[],
    dateCol: string | null, dateColType: string | null, numericCols: string[], categoryCols: string[],
    schemaDef: string, sampleData: any[],
    ragContext: string = "", statsSummary: string = "",
    forecastDimension: string | null = null
): string {
    const totalRows = sampleData.length;
    const sampleJson = JSON.stringify(sampleData.slice(0, 5), null, 2);
    const dimensionText = forecastDimension ? `, dimension: "${forecastDimension}"` : "";
    const dataSource = analysisType === "forecast" && totalRows <= 500
        ? `SQL-aggregated (${totalRows} rows, grouped by ${dateCol || "period"}${dimensionText}) — full dataset used`
        : `Sampled ${totalRows} rows from the full table`;
    const dateHint = dateCol
        ? `- Date column: "${dateCol}" (PostgreSQL type: ${dateColType || "unknown"}, use for time-series if applicable)`
        : "- No date column detected";

    const chartRules: Record<string, { chart: string; reason: string }> = {
        forecast: { chart: "line", reason: "Time-series trends — line chart shows change over time clearly" },
        cluster: { chart: "bar", reason: "Cluster sizes and characteristics — bar chart for easy comparison" },
        correlation: { chart: "scatter", reason: "Relationship between two variables — scatter plot with trend line" },
        regression: { chart: "scatter", reason: "Predicted vs actual values — scatter plot with regression line" },
        general: { chart: "bar", reason: "Categorical comparison or histogram for distribution" },
    };
    const chartInfo = chartRules[analysisType] || chartRules.general;

    const dimensionHint = forecastDimension
        ? `- Data includes dimension "${forecastDimension}" — generate a SEPARATE forecast for each unique value in this dimension\n- Group the data by "${forecastDimension}" first, then forecast each group independently\n- Print forecasted values per dimension clearly`
        : "";

    const analysisHints: Record<string, string> = {
        forecast: `## Time-Series Forecasting
- Use pandas + statsmodels (SARIMAX) or sklearn
- If "${dateCol}" exists, parse it as datetime, set as index, and forecast the next ${Math.max(3, Math.min(12, columns.length))} periods
- If no date column, try to infer row order as time
- Print the forecasted values clearly
${dimensionHint}`,
        cluster: `## Clustering Analysis
- Use sklearn KMeans
- Use ONLY numeric columns: ${numericCols.join(", ") || "auto-detect"}
- Determine optimal K using elbow method (try 2-5)
- Print cluster sizes and average values per cluster
- Describe each cluster's characteristics`,
        correlation: `## Correlation Analysis
- Use pandas .corr() or scipy.stats.pearsonr
- Focus on relationships between numeric columns: ${numericCols.join(", ") || "all numeric"}
- Print correlation matrix and highlight strong correlations (>0.5 or <-0.5)
- If a date column exists, check trends over time`,
        regression: `## Regression Analysis
- Use sklearn LinearRegression or statsmodels OLS
- Identify target and feature columns from numeric columns: ${numericCols.join(", ") || "auto-detect"}
- Print R² score, coefficients, and p-values if available
- Interpret the results in business terms`,
        general: `## General Statistical Analysis
- Provide descriptive statistics (mean, median, std, min, max) for numeric columns
- If ${categoryCols.length > 0 ? "categorical columns exist (" + categoryCols.join(", ") + ")" : "no categorical columns"}, show distribution counts
- Check for outliers and missing values
- Print a clear summary of findings`,
    };

    const dimensionChartHint = forecastDimension
        ? `\n- Since data includes dimension "${forecastDimension}", use a separate line (or subplot) for each unique value. Add a legend showing which line belongs to which category.`
        : "";

    const forecastAggNote = analysisType === "forecast"
        ? `The data is PRE-AGGREGATED by ${dateCol || "period"} (${totalRows} rows). Use it directly for time-series forecasting. If you need more granular data, note that this is already the full aggregated dataset.`
        : `The data contains ${totalRows} sampled rows from the full table — sufficient for analysis.`;

    // Use YAML template and replace placeholders
    let prompt = (prompts.data_scientist_python_gen as string)
        .replace(/\{tableName\}/g, tableName)
        .replace(/\{columns\}/g, columns.join(", "))
        .replace(/\{dateHint\}/g, dateHint)
        .replace(/\{numericCols\}/g, numericCols.join(", ") || "auto-detect from data")
        .replace(/\{categoryCols\}/g, categoryCols.join(", ") || "auto-detect from data")
        .replace(/\{schemaDef\}/g, schemaDef)
        .replace(/\{ragContext\}/g, ragContext)
        .replace(/\{dataSource\}/g, dataSource)
        .replace(/\{sampleJson\}/g, sampleJson)
        .replace(/\{statsSummary\}/g, statsSummary)
        .replace(/\{analysisType\}/g, analysisType.toUpperCase())
        .replace(/\{analysisHints\}/g, analysisHints[analysisType] || analysisHints.general)
        .replace(/\{chartType\}/g, chartInfo.chart.toUpperCase())
        .replace(/\{chartReason\}/g, chartInfo.reason)
        .replace(/\{totalRows\}/g, String(totalRows));

    // Add dimension-specific chart hint
    if (dimensionChartHint) {
        prompt = prompt.replace(
            "- general: Bar chart for categorical counts or histogram for distributions.",
            `- general: Bar chart for categorical counts or histogram for distributions.${dimensionChartHint}`
        );
    }

    // Add sample data as hardcoded dictionary (Rule 2)
    prompt += `\n\n## Rules\n2. Load data from the hardcoded dictionary below — do NOT read any external file or CSV:\n   data = ${JSON.stringify(sampleData, null, 2)}\n`;
    prompt += `\n11. ${forecastAggNote}`;

    return prompt;
}
