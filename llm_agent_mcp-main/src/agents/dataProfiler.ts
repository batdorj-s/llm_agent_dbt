import { invokeWithFallback } from "../llm-provider.js";
import { addDocumentToCatalog } from "../rag.js";
import { prompts } from "./prompts.js";

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
