import { invokeWithFallback } from "../llm-provider.js";
import { addDocumentToCatalog } from "../rag.js";

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

  const prompt = `You are a senior data analyst. Analyze this table and generate a structured data passport.

Table Name: ${tableName}
Description: ${description}
Columns:
${columnInfo}

Sample Data (first ${Math.min(sampleRows.length, 10)} rows):
${sampleJson}

Return ONLY valid JSON with this exact structure:
{
  "domain": "the business domain (e.g. e-commerce, finance, healthcare, retail, marketing)",
  "industry": "specific industry name",
  "dimensions": [
    {"name": "column_name", "description": "what this dimension represents in Mongolian", "type": "time|category|geography|id"}
  ],
  "metrics": [
    {"name": "column_name", "description": "what this metric represents in Mongolian", "aggregation": "sum|avg|count|distinct_count"}
  ],
  "topBusinessQuestions": [
    "Mongolian business question 1 that this data can answer",
    "Mongolian business question 2",
    "Mongolian business question 3",
    "Mongolian business question 4",
    "Mongolian business question 5"
  ]
}

Respond with ONLY the raw JSON. No markdown, no code fences, no explanations.`;

  try {
    const result = await invokeWithFallback([
      { role: "system", content: "You are a precise data analyst. Return ONLY valid JSON without any markdown formatting or code fences." },
      { role: "user", content: prompt }
    ], { temperature: 0.1, timeout: 30000 });

    if (!result?.content) {
      console.warn(`[DataProfiler] No LLM response for ${tableName}`);
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
