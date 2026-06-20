import { createLLM, createLLMWithOrder } from "../llm-provider.js";
import { getActiveCatalogEntry, buildSchemaDefinition } from "../db/data-lake.js";
import { handleExecuteSql } from "../tools/enterprise-tools.js";
import { runPythonCode } from "../sandbox.js";
import { sandboxLimiter } from "../rate-limiter.js";
import { searchKnowledgeBase } from "../rag.js";
import { selfQueryTransform, searchKnowledgeBaseWithFilter } from "../rag.js";

const LLM_TIMEOUT_MS = 40000;
const PYTHON_GEN_TIMEOUT_MS = 55000;

export async function dataScientistNode(state: any, config?: any): Promise<Partial<import("../multi-agent.js").AgentState>> {
    const onChunk = config?.configurable?.onChunk;
    const lastMsg = state.messages[state.messages.length - 1];
    const query = lastMsg ? lastMsg.content : "";

    const prefix = "(Data Scientist Agent)\nӨгөгдөлд шинжилгээ хийж байна...\n\n";
    if (onChunk) onChunk(prefix);

    const activeEntry = await getActiveCatalogEntry();
    if (!activeEntry) {
        const fallback = `${prefix}⚠️ Идэвхтэй хүснэгт олдсонгүй. Эхлээд өгөгдөл оруулна уу.`;
        if (onChunk) onChunk(fallback);
        return { messages: [{ role: "assistant", content: fallback }] };
    }

    const schemaDef = await buildSchemaDefinition(activeEntry);
    const tableName = activeEntry.table_name;
    let columnList: string[] = [];
    try {
        columnList = JSON.parse(activeEntry.columns_info) as string[];
    } catch { }

    console.log(`[DataScientist] Active table: ${tableName}, columns: ${columnList.join(", ")}`);

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
                console.log(`[DataScientist] Self-query filter: ${JSON.stringify(filter)}`);
            } catch (sqErr) {
                console.warn("[DataScientist] Self-query failed:", (sqErr as Error).message);
            }
        }

        const ragData = filter
            ? await searchKnowledgeBaseWithFilter({ query: filter.query || query, agentRole: "DataScientistAgent", limit: 2, filter })
            : await searchKnowledgeBase(query, "DataScientistAgent", 2);
        const docs = ragData.documents?.[0] ?? [];
        if (docs.length > 0) {
            ragContext = "\n\n## Relevant Knowledge\n" + docs.join("\n\n---\n\n");
            console.log(`[DataScientist] Enriched with ${docs.length} RAG docs`);
        }
    } catch (err) {
        console.warn("[DataScientist] RAG fetch failed:", (err as Error).message);
    }

    if (!llm) {
        const fallback = `${prefix}⚠️ LLM API key тохируулаагүй байна.`;
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

    console.log(`[DataScientist] Analysis type detected: ${analysisType}`);

    const dateCol = findDateColumn(columnList);
    const numericCols = findNumericColumns(columnList);
    const categoryCols = findCategoryColumns(columnList);

    const samplingSql = buildSamplingSql(tableName, columnList);
    let sampleData: any[] = [];
    try {
        const sampleResult = await handleExecuteSql({ query: samplingSql });
        if (sampleResult.ok && sampleResult.results) {
            sampleData = Array.isArray(sampleResult.results) ? sampleResult.results : [sampleResult.results];
        }
    } catch (err) {
        console.warn("[DataScientist] Sample data fetch failed:", (err as Error).message);
    }

    const pythonSystemPrompt = buildPythonPrompt(
        analysisType, tableName, columnList,
        dateCol, numericCols, categoryCols,
        schemaDef, sampleData, ragContext
    );

    try {
        if (onChunk) onChunk(`\n*Python код бэлдэж байна...*\n`);

        const executeGen = async (model: any) => {
            return await withTimeout(model.invoke([
                { role: "system", content: pythonSystemPrompt },
                { role: "user", content: query }
            ]), "DataScientist Python generation", PYTHON_GEN_TIMEOUT_MS);
        };

        let codeGenResponse: any;
        try {
            codeGenResponse = await executeGen(llm);
        } catch (err: any) {
            console.warn("[DataScientist] Primary LLM failed, attempting fallback:", err.message);
            const fallbackLLM = await createLLMWithOrder({ temperature: 0, providerOrder: ["groq", "gemini", "openai"] });
            if (fallbackLLM) {
                codeGenResponse = await executeGen(fallbackLLM);
            } else {
                throw err;
            }
        }

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

        const limiterKey = config?.configurable?.threadId || "data-scientist-global";
        const limiterResult = sandboxLimiter.check(limiterKey);
        if (!limiterResult.allowed) {
            const waitMsg = `\n⚠️ Шинжилгээний хязгаарт хүрлээ. ${Math.ceil(limiterResult.resetInMs / 1000)} секунд хүлээнэ үү.\n`;
            if (onChunk) onChunk(waitMsg);
            const fallback = `${prefix}\`\`\`python\n${pythonCode}\n\`\`\`\n\n${waitMsg}`;
            return { messages: [{ role: "assistant", content: fallback }] };
        }

        const output = await runPythonCode(pythonCode);

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

        const explainPrompt = `You are a senior data scientist. Explain the Python analysis results in Mongolian to a business user. Be concise, clear, and actionable.

Analysis type: ${analysisType}
User query: ${query}

Python code executed:
${pythonCode}

Output:
${output}

CRITICAL: 
- If this was a forecast, state the predicted values and confidence
- If this was clustering, describe each cluster's characteristics
- If this was correlation/regression, state the relationship strength and direction
- Always include the actual numbers from the output
- End with a business recommendation in Mongolian`;

        const stream = await withTimeout(llm.stream([
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
        const fallback = `${prefix}⚠️ Шинжилгээ хийхэд алдаа гарлаа: ${(err as Error).message}`;
        if (onChunk) onChunk(fallback);
        return { messages: [{ role: "assistant", content: fallback }] };
    }
}

function buildSamplingSql(tableName: string, columns: string[]): string {
    const safeCols = columns.map(c => `"${c}"`).join(", ");
    return `SELECT ${safeCols} FROM "${tableName}" LIMIT 1000;`;
}

function findDateColumn(columns: string[]): string | null {
    const datePatterns = [/date/i, /time/i, /month/i, /year/i, /timestamp/i, /day/i, /order_date/i, /invoice/i];
    for (const col of columns) {
        for (const pat of datePatterns) {
            if (pat.test(col)) return col;
        }
    }
    return null;
}

function findNumericColumns(columns: string[]): string[] {
    const numericKeywords = [/age/i, /amount/i, /balance/i, /price/i, /cost/i, /revenue/i, /sales/i,
        /income/i, /profit/i, /spend/i, /value/i, /quantity/i, /count/i, /rate/i, /score/i,
        /duration/i, /length/i, /size/i, /total/i, /sum/i, /avg/i, /num/i];
    return columns.filter(col => numericKeywords.some(p => p.test(col)));
}

function findCategoryColumns(columns: string[]): string[] {
    const categoryKeywords = [/category/i, /type/i, /status/i, /segment/i, /group/i, /class/i,
        /region/i, /city/i, /country/i, /state/i, /gender/i, /education/i, /job/i,
        /marital/i, /deposit/i, /loan/i, /default/i, /housing/i, /contact/i, /poutcome/i,
        /channel/i, /campaign/i, /product/i, /item/i, /brand/i, /model/i];
    return columns.filter(col => categoryKeywords.some(p => p.test(col)));
}

function buildPythonPrompt(
    analysisType: string, tableName: string, columns: string[],
    dateCol: string | null, numericCols: string[], categoryCols: string[],
    schemaDef: string, sampleData: any[],
    ragContext: string = ""
): string {
    const sampleJson = JSON.stringify(sampleData.slice(0, 5), null, 2);
    const dateHint = dateCol ? `- Date column: "${dateCol}" (use for time-series if applicable)` : "- No date column detected";

    const chartRules: Record<string, { chart: string; reason: string }> = {
        forecast: { chart: "line", reason: "Time-series trends — line chart shows change over time clearly" },
        cluster: { chart: "bar", reason: "Cluster sizes and characteristics — bar chart for easy comparison" },
        correlation: { chart: "scatter", reason: "Relationship between two variables — scatter plot with trend line" },
        regression: { chart: "scatter", reason: "Predicted vs actual values — scatter plot with regression line" },
        general: { chart: "bar", reason: "Categorical comparison or histogram for distribution" },
    };
    const chartInfo = chartRules[analysisType] || chartRules.general;

    const analysisHints: Record<string, string> = {
        forecast: `## Time-Series Forecasting
- Use pandas + statsmodels (SARIMAX) or sklearn
- If "${dateCol}" exists, parse it as datetime, set as index, and forecast the next ${Math.max(3, Math.min(12, columns.length))} periods
- If no date column, try to infer row order as time
- Print the forecasted values clearly`,
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

    return `You are a senior data scientist. Write executable Python 3 code for data analysis.
Use pandas, numpy, scikit-learn, statsmodels, matplotlib, and seaborn as needed.

## Available Data
The data is from table "${tableName}" with columns: ${columns.join(", ")}
${dateHint}
Numeric columns: ${numericCols.join(", ") || "auto-detect from data"}
Categorical columns: ${categoryCols.join(", ") || "auto-detect from data"}

## Schema
${schemaDef}
${ragContext}

## Sample Data (first 5 rows)
${sampleJson}

## Analysis Type: ${analysisType.toUpperCase()}
${analysisHints[analysisType] || analysisHints.general}

## CHART GENERATION — CRITICAL
You MUST generate a chart/plot and save it as a PNG file. Charts are the primary output.

### Chart Type for This Analysis: ${chartInfo.chart.toUpperCase()} — ${chartInfo.reason}

### Required Plotting Template
Use this EXACT template for every chart:
\`\`\`python
import matplotlib.pyplot as plt
import seaborn as sns

plt.style.use('seaborn-v0_8-darkgrid')
fig, ax = plt.subplots(figsize=(10, 6))

# [YOUR PLOTTING CODE HERE]

ax.set_title('Title in Mongolian or English', fontsize=14, fontweight='bold')
ax.set_xlabel('X-axis label', fontsize=11)
ax.set_ylabel('Y-axis label', fontsize=11)
ax.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig('analysis_plot.png', dpi=150, bbox_inches='tight')
plt.close()
\`\`\`

### Chart Guidelines by Type
- **forecast**: Line chart. Plot historical values as solid line, forecasted values as dashed line with confidence interval shading.
- **cluster**: Bar chart. Show cluster sizes (count) as bars, optionally add a second chart showing average values per cluster.
- **correlation**: Scatter plot. Use sns.regplot() to add regression line. Add correlation coefficient in title.
- **regression**: Scatter plot of predicted vs actual. Include R² in title. Add residual plot as second subplot.
- **general**: Bar chart for categorical counts or histogram for numeric distributions.

### Styling Rules
- Use seaborn-v0_8-darkgrid style
- Figure size: (10, 6)
- Color palette: sns.color_palette("viridis", 8) or sns.color_palette("husl", 8)
- DPI: 150
- Label font size: 11, title font size: 14 bold
- Add grid with alpha=0.3
- Rotate x-axis labels 45 degrees if they overlap

## Rules
1. Import all libraries inside the code. Do NOT assume pre-installed packages beyond: pandas, numpy, scikit-learn, statsmodels, scipy, matplotlib, seaborn
2. Load data from the hardcoded dictionary below - do NOT read any external file:
   data = ${JSON.stringify(sampleData, null, 2)}
3. Convert the list of dicts to a pandas DataFrame: df = pd.DataFrame(data)
4. Handle missing values with df.fillna(0) or df.dropna()
5. Print ALL numerical results clearly. Use print() for every important output.
6. CRITICAL: Do NOT try to read CSV files or connect to databases. The data is already loaded as the 'data' variable above.
7. Do NOT use exit() or sys.exit().
8. ALWAYS save the chart as 'analysis_plot.png' using plt.savefig().
9. After saving the chart, print the text "##CHART_SAVED##" on its own line so the system knows the chart was generated.
10. Return ONLY the Python code inside a markdown \`\`\`python block. No explanation outside the block.`;
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number = LLM_TIMEOUT_MS): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    });
}
