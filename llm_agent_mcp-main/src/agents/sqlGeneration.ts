import { getCatalog, getActiveCatalogEntry, buildSchemaDefinition } from "../db/data-lake.js";
import { safeJsonParse, queryMentionsTable } from "../utils.js";
import type { DataLakeCatalogEntry } from "../db/data-lake.js";
import { findConceptColumn } from "./columnSynonyms.js";

export const MAX_SQL_RETRIES = 2;
export const SQL_GEN_TIMEOUT_MS = 55000;

export function isRateLimitError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /rate limit|429|tokens per day|TPD|quota exceeded|quota.*limit/i.test(message);
}

export async function buildActiveSchemaContext(query: string, userId: string): Promise<string> {
    const catalog = await getCatalog(userId);
    if (!catalog || catalog.length === 0) return "(catalog unavailable)";

    const mentioned = catalog.find((e: any) =>
        queryMentionsTable(query, e.table_name)
    );
    if (mentioned) return await buildSchemaDefinition(mentioned);

    const active = await getActiveCatalogEntry(userId);
    if (active) return await buildSchemaDefinition(active);

    return await buildSchemaDefinition(catalog as any);
}

export async function getActiveColumns(entry: Promise<DataLakeCatalogEntry | null>): Promise<string[]> {
    const resolved = await entry;
    if (!resolved) return [];
    try {
        return JSON.parse(resolved.columns_info) as string[];
    } catch {
        return [];
    }
}

export function findColumn(columns: string[], patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
        const match = columns.find((column) => pattern.test(column));
        if (match) return match;
    }
    return null;
}

export async function buildDeterministicTechSql(query: string, entry?: DataLakeCatalogEntry | null): Promise<string | null> {
    const resolvedEntry = entry ?? null;
    if (!resolvedEntry) return null;

    const lowerQuery = query.toLowerCase();
    const columns = await getActiveColumns(Promise.resolve(resolvedEntry));
    const tableName = resolvedEntry.table_name;

    const itemColumn = findConceptColumn(columns, "product", tableName);
    const salesColumn = findConceptColumn(columns, "sales", tableName);

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

export function formatDeterministicTechResponse(query: string, sql: string, results: any[]): string {
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

export function buildFallbackQuery(query: string, entry?: any): string | null {
    if (!entry) return null;
    const tableName = entry.table_name;
    let columns: string[] = [];
    try { columns = JSON.parse(entry.columns_info) as string[]; } catch { return null; }
    if (columns.length === 0) return null;

    const lowerQuery = query.toLowerCase();
    const incomeCol = findConceptColumn(columns, "income", tableName)
        || columns.find(c => /gross_income/i.test(c))
        || columns.find(c => /income/i.test(c))
        || null;

    const isOutlierQuery = /outlier|гажуудал|хэт өндөр|хэт бага|аномали|anomaly|етгээд|стандарт хазайлт|standard deviation|z-score|3σ/i.test(lowerQuery);
    const isIncomeQuery = /gross income|нийт борлуулалт|income|орлого|ашиг/i.test(lowerQuery);

    if (isOutlierQuery && incomeCol) {
        return [
            `SELECT "${incomeCol}" AS outlier_value`,
            `FROM "${tableName}"`,
            `WHERE "${incomeCol}" > (SELECT AVG("${incomeCol}") + 2 * STDDEV("${incomeCol}") FROM "${tableName}")`,
            `   OR "${incomeCol}" < (SELECT AVG("${incomeCol}") - 2 * STDDEV("${incomeCol}") FROM "${tableName}")`,
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

export function computeResultStats(sandboxResult: string): string {
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

export function generateVisualTag(jsonResults: string): string {
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
