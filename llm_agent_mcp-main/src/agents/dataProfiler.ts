import { invokeWithFallback } from "../llm-provider.js";
import { addDocumentToCatalog } from "../rag.js";
import { prompts } from "./prompts.js";
import { computeColumnStats, type ColumnStats } from "./statistics.js";

const DATA_PROFILER_TIMEOUT_MS = parseInt(process.env.DATA_PROFILER_TIMEOUT_MS || "30000", 10);

export interface DataDimension {
  name: string;
  description: string;
  type: "time" | "category" | "geography" | "id";
}

export interface DataMetric {
  name: string;
  description: string;
  aggregation: "sum" | "avg" | "count" | "distinct_count";
}

export interface DataPassport {
  domain: string;
  industry: string;
  dimensions: DataDimension[];
  metrics: DataMetric[];
  topBusinessQuestions: string[];
}

/**
 * Rule-based data profiling: generates column statistics without LLM.
 * Faster and deterministic — uses only computeColumnStats from statistics.ts.
 */
export function generateRuleBasedProfile(
  tableName: string,
  columns: string[],
  sampleData: Record<string, unknown>[]
): {
  numericStats: Array<{ column: string; stats: ColumnStats }>;
  categoricalStats: Array<{ column: string; distinctCount: number; topValues: string[] }>;
  summary: string;
} {
  const numericStats: Array<{ column: string; stats: ColumnStats }> = [];
  const categoricalStats: Array<{ column: string; distinctCount: number; topValues: string[] }> = [];

  for (const col of columns) {
    const values = sampleData.map(r => r[col]);
    const numericValues = values
      .map(v => typeof v === "number" ? v : parseFloat(String(v)))
      .filter(v => !isNaN(v));

    if (numericValues.length > sampleData.length * 0.5) {
      // Numeric column
      const stats = computeColumnStats(numericValues);
      if (stats) {
        numericStats.push({ column: col, stats });
      }
    } else {
      // Categorical column
      const valueCounts = new Map<string, number>();
      for (const v of values) {
        const key = String(v ?? "NULL");
        valueCounts.set(key, (valueCounts.get(key) || 0) + 1);
      }
      const topValues = [...valueCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([val]) => val);
      categoricalStats.push({ column: col, distinctCount: valueCounts.size, topValues });
    }
  }

  const lines: string[] = [];
  lines.push(`## Өгөгдлийн профайл: ${tableName}`);
  lines.push(`**Нийт мөр**: ${sampleData.length}`);
  lines.push(`**Баганууд**: ${columns.length}`);
  lines.push("");

  if (numericStats.length > 0) {
    lines.push("### Тоон өгөгдлийн статистик");
    for (const { column, stats } of numericStats) {
      lines.push(`- **${column}**: дундаж=${stats.mean.toFixed(2)}, медиан=${stats.median.toFixed(2)}, стандарт=${stats.std.toFixed(2)}, хүрээ=[${stats.min.toFixed(2)}, ${stats.max.toFixed(2)}]`);
    }
    lines.push("");
  }

  if (categoricalStats.length > 0) {
    lines.push("### Ангиллын өгөгдлийн статистик");
    for (const { column, distinctCount, topValues } of categoricalStats) {
      lines.push(`- **${column}**: ${distinctCount} төрөл, тэргүүлэх: ${topValues.join(", ")}`);
    }
  }

  const summary = lines.join("\n");

  return { numericStats, categoricalStats, summary };
}

/**
 * Detect data quality issues from rule-based profile.
 */
export function detectDataQualityIssues(
  sampleData: Record<string, unknown>[],
  columns: string[]
): Array<{ column: string; issue: string; severity: "low" | "medium" | "high" }> {
  const issues: Array<{ column: string; issue: string; severity: "low" | "medium" | "high" }> = [];

  for (const col of columns) {
    const values = sampleData.map(r => r[col]);
    const nullCount = values.filter(v => v === null || v === undefined || v === "").length;
    const nullPct = (nullCount / values.length) * 100;

    if (nullPct > 50) {
      issues.push({ column: col, issue: `${nullPct.toFixed(0)}% хоосон утга`, severity: "high" });
    } else if (nullPct > 20) {
      issues.push({ column: col, issue: `${nullPct.toFixed(0)}% хоосон утга`, severity: "medium" });
    }

    // Check for duplicates in what looks like ID columns
    if (/id$|code$/i.test(col)) {
      const unique = new Set(values.map(String));
      if (unique.size < values.length) {
        const dupCount = values.length - unique.size;
        issues.push({ column: col, issue: `${dupCount} давхардалтай утга`, severity: "medium" });
      }
    }
  }

  return issues;
}

/**
 * Generate column-level data quality report for RAG context.
 */
export function generateQualityReport(
  tableName: string,
  issues: Array<{ column: string; issue: string; severity: "low" | "medium" | "high" }>
): string {
  if (issues.length === 0) {
    return `## Мэдээллийн чанар: ${tableName}\n✅ Багануудад ноцтой асуудал олдсонгүй.`;
  }

  const high = issues.filter(i => i.severity === "high");
  const medium = issues.filter(i => i.severity === "medium");
  const low = issues.filter(i => i.severity === "low");

  const lines: string[] = [];
  lines.push(`## Мэдээллийн чанар: ${tableName}`);
  lines.push(`- ⛔ Дөндөр түвшин: ${high.length}`);
  lines.push(`- ⚠️ Дунд түвшин: ${medium.length}`);
  lines.push(`- 💡 Бага түвшин: ${low.length}`);
  lines.push("");

  for (const issue of [...high, ...medium, ...low]) {
    const icon = issue.severity === "high" ? "⛔" : issue.severity === "medium" ? "⚠️" : "💡";
    lines.push(`${icon} **${issue.column}**: ${issue.issue}`);
  }

  return lines.join("\n");
}

export async function generateDataPassport(
  tableName: string,
  columns: string[],
  sampleRows: Record<string, unknown>[],
  description: string
): Promise<DataPassport | null> {
  const columnInfo = columns.map(c => `  - "${c}"`).join("\n");
  const sampleJson = JSON.stringify(sampleRows.slice(0, 10), null, 2);

  const prompt = (prompts.data_profiler_passport as string)
    .replace(/\{tableName\}/g, tableName)
    .replace(/\{description\}/g, description)
    .replace(/\{columnInfo\}/g, columnInfo)
    .replace(/\{sampleRows\}/g, String(Math.min(sampleRows.length, 10)))
    .replace(/\{sampleJson\}/g, sampleJson);

  try {
    const result = await invokeWithFallback([
      { role: "system", content: prompts.data_profiler_system as string },
      { role: "user", content: prompt }
    ], { temperature: 0.1, timeout: DATA_PROFILER_TIMEOUT_MS });

    if (!result.content) {
      console.warn(`[DataProfiler] Empty LLM response for ${tableName}`);
      return null;
    }

    let clean = result.content.trim();
    clean = clean.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    const passport = JSON.parse(clean) as DataPassport;

    if (!passport.domain || !passport.industry || !Array.isArray(passport.dimensions) || !Array.isArray(passport.metrics)) {
      console.warn(`[DataProfiler] Invalid passport structure for ${tableName}`);
      return null;
    }

    const passportText = [
      `## Өгөгдлийн паспорт: ${tableName}`,
      ``,
      `**Салбар**: ${passport.industry}`,
      `**Домэйн**: ${passport.domain}`,
      ``,
      `### Хэмжүүсүүд (Dimensions)`,
      passport.dimensions.map(d => `- **${d.name}** (${d.type}): ${d.description}`).join("\n"),
      ``,
      `### Үзүүлэлтүүд (Metrics)`,
      passport.metrics.map(m => `- **${m.name}** (${m.aggregation}): ${m.description}`).join("\n"),
      ``,
      `### Тэргүүлэх 5 бизнесийн асуулт`,
      passport.topBusinessQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    ].join("\n");

    const keywords = [
      tableName.toLowerCase(),
      "data_passport", "semantic_profile",
      ...passport.dimensions.map(d => d.name.toLowerCase()),
      ...passport.metrics.map(m => m.name.toLowerCase()),
      ...passport.industry.toLowerCase().split(/\W+/).filter(Boolean),
      ...passport.domain.toLowerCase().split(/\W+/).filter(Boolean),
      ...passport.topBusinessQuestions.flatMap(q =>
        q.toLowerCase().split(/\W+/).filter(w => w.length > 2)
      ),
    ];

    await addDocumentToCatalog(
      `passport_${tableName}`,
      passportText,
      {
        category: "data_catalog",
        department: "analytics",
        author: "system",
        source_name: `Data Passport: ${tableName}`,
        shared: true,
      },
      [...new Set(keywords)]
    );

    console.log(`[DataProfiler] Data passport generated for '${tableName}' [OK]`);
    return passport;
  } catch (err) {
    console.warn(`[DataProfiler] Failed to generate passport for ${tableName}:`, (err as Error).message);
    return null;
  }
}
