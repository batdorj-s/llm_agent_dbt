import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import path from "path";

export interface RagDocument {
  id: string;
  text: string;
  metadata: {
    category: "finance" | "technical" | "business_policy" | "data_catalog" | "previous_analysis";
    department: string;
    author?: string;
    created_at?: string;
    source_name?: string;
  };
  keywords: string[];
}

export interface SelfQueryFilter {
  query: string;
  categories?: string[];
  departments?: string[];
  author?: string;
  year?: number;
}

export let knowledgeDocuments: RagDocument[] = [
  {
    id: "doc1",
    text: "Sales refers to the total revenue generated from closed deals, calculated from the active Data Lake dataset's revenue or amount column. The current annual target is set to 500,000 USD.",
    metadata: { category: "finance", department: "sales", author: "admin", created_at: "2026-01-01", source_name: "Business Glossary" },
    keywords: ["sales", "revenue", "target", "deals", "kpi", "kpi target"]
  },
  {
    id: "doc2",
    text: "Churn Rate is the percentage of users who have not made a purchase in over 6 months. The acceptable threshold is under 2.0%.",
    metadata: { category: "finance", department: "retention", author: "admin", created_at: "2026-01-01", source_name: "Business Glossary" },
    keywords: ["churn", "users", "cancel", "subscription", "retention", "percentage"]
  },
  {
    id: "doc3",
    text: "The Enterprise AI Orchestrator uses a unified Admin access model. All authenticated users have full access to SQL analysis, Python sandboxing, and KPI management.",
    metadata: { category: "business_policy", department: "security", author: "admin", created_at: "2026-01-01", source_name: "Access Policy" },
    keywords: ["policy", "rbac", "admin", "access", "security", "compliance", "unified"]
  },
  {
    id: "doc4",
    text: "Data Lake Catalog: Use the active uploaded table from the catalog for transaction analytics. Always read the live schema before writing SQL, and do not assume older table names or columns unless they appear in the current catalog.",
    metadata: { category: "data_catalog", department: "analytics", author: "admin", created_at: "2026-01-01", source_name: "Data Lake Guide" },
    keywords: ["catalog", "columns", "sales", "category", "data lake", "sql", "schema"]
  },
  {
    id: "doc5",
    text: "Data Lake Catalog: Historical trend analysis should use the live catalog entry for the currently loaded dataset. If dates contain dots, normalize them with REPLACE(column, '.', '-') before date grouping.",
    metadata: { category: "data_catalog", department: "analytics", author: "admin", created_at: "2026-01-01", source_name: "Data Lake Guide" },
    keywords: ["catalog", "columns", "order_date", "sales", "category", "data lake", "sql", "date"]
  },
  {
    id: "doc6",
    text: "SQL Best Practices: Always use ILIKE for case-insensitive text matching. Use DATE_TRUNC for time-series grouping. Use COALESCE to handle null values. Never use backticks — PostgreSQL uses double quotes for identifiers.",
    metadata: { category: "technical", department: "engineering", author: "admin", created_at: "2026-01-01", source_name: "SQL Style Guide" },
    keywords: ["sql", "ilike", "date_trunc", "coalesce", "postgresql", "best practices", "query"]
  },
  {
    id: "doc7",
    text: "Dashboard Design: A dashboard consists of 4-6 widgets. Each widget has a type (kpi, bar, line, pie, area), a title in Mongolian, a SQL query, and a unit. KPI widgets return a single number. Bar/Pie charts group by categorical columns. Line/Area charts group by date columns.",
    metadata: { category: "technical", department: "engineering", author: "admin", created_at: "2026-01-01", source_name: "Dashboard Guide" },
    keywords: ["dashboard", "widget", "kpi", "bar", "line", "pie", "chart", "visualization"]
  },
  {
    id: "doc8",
    text: "Python Analysis: The E2B Sandbox supports pandas, numpy, scikit-learn, statsmodels, scipy, matplotlib, and seaborn. Data is passed as inline JSON. Plots must be saved as 'analysis_plot.png'. Output text is captured from stdout.",
    metadata: { category: "technical", department: "engineering", author: "admin", created_at: "2026-01-01", source_name: "Sandbox Guide" },
    keywords: ["python", "sandbox", "e2b", "pandas", "matplotlib", "plot", "analysis"]
  },
];

export const mockDocuments = knowledgeDocuments;

const ROLE_CATEGORY_MAP: Record<string, string[]> = {
  FinanceAgent: ["finance", "business_policy"],
  TechAgent: ["technical", "data_catalog"],
  DataScientistAgent: ["technical", "data_catalog", "previous_analysis"],
};

function inMemorySearch(query: string, limit: number, categories?: string[], userId?: string) {
  const queryWords = query.toLowerCase().split(/\W+/).filter(Boolean);

  let docs = knowledgeDocuments;
  if (userId) {
    docs = docs.filter(d => !d.metadata.author || d.metadata.author === "admin" || d.metadata.author === "system" || d.metadata.author === userId);
  } else {
    // If no userId is specified, only return system/admin documents for security
    docs = docs.filter(d => !d.metadata.author || d.metadata.author === "admin" || d.metadata.author === "system");
  }
  if (categories && categories.length > 0) {
    docs = docs.filter(d => categories.includes(d.metadata.category));
  }

  const scored = docs.map(doc => {
    const score = queryWords.reduce((acc, word) => {
      if (doc.keywords.includes(word)) return acc + 2;
      if (doc.text.toLowerCase().includes(word)) return acc + 1;
      return acc;
    }, 0);
    return { doc, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.doc);
}

function recursiveSearch(query: string, limit: number, categories?: string[], userId?: string): RagDocument[] {
  const results = inMemorySearch(query, limit, categories, userId);

  if (results.length < limit && categories) {
    const queryWords = query.toLowerCase().split(/\W+/).filter(Boolean);
    for (const word of queryWords) {
      if (word.length < 3) continue;
      const extra = inMemorySearch(word, 1, categories, userId);
      for (const doc of extra) {
        if (!results.find(r => r.id === doc.id)) {
          results.push(doc);
        }
      }
      if (results.length >= limit) break;
    }
  }

  return results.slice(0, limit);
}

function formatWithSource(docs: RagDocument[]): string {
  return docs.map(doc => {
    const source = doc.metadata.source_name ? `[Source: ${doc.metadata.source_name}]` : "";
    const dept = doc.metadata.department ? `(${doc.metadata.department})` : "";
    return `${source}${dept ? " " + dept : ""}\n${doc.text}`;
  }).join("\n\n---\n\n");
}

let chromaClient: any = null;
let collection: any = null;

async function getChromaCollection() {
  if (collection) return collection;

  const hasChromaUrl = process.env.CHROMA_URL;
  const hasOpenAIKey = process.env.OPENAI_API_KEY &&
    process.env.OPENAI_API_KEY !== "your_openai_api_key_here";

  if (!hasChromaUrl || !hasOpenAIKey) return null;

  try {
    const { ChromaClient, OpenAIEmbeddingFunction } = await import("chromadb") as any;

    chromaClient = new ChromaClient({ path: process.env.CHROMA_URL });

    const embedder = new OpenAIEmbeddingFunction({
      openai_api_key: process.env.OPENAI_API_KEY!,
      openai_model: "text-embedding-3-small",
    });

    collection = await chromaClient.getOrCreateCollection({
      name: "enterprise-kb",
      embeddingFunction: embedder,
      metadata: { "hnsw:space": "cosine" },
    });

    console.log("[VectorDB] ChromaDB collection ready [OK]");
    return collection;
  } catch (err) {
    console.warn("[VectorDB] ChromaDB unavailable, using in-memory fallback:", (err as Error).message);
    return null;
  }
}

export async function setupKnowledgeBase() {
  // Load approved feedback from failed_queries.json first
  try {
    const failedQueriesPath = path.join(process.cwd(), "logs", "failed_queries.json");
    if (fs.existsSync(failedQueriesPath)) {
      const data = JSON.parse(fs.readFileSync(failedQueriesPath, "utf8"));
      for (const entry of data) {
        if (entry.status === "approved" && entry.response) {
          const ragText = `Failed Query: User asked "${entry.message}". The system responded with: "${entry.response}". This response was rated as incorrect.`;
          if (!knowledgeDocuments.some(d => d.id === entry.id)) {
            knowledgeDocuments.push({
              id: entry.id,
              text: ragText,
              metadata: {
                category: "previous_analysis",
                department: "analytics",
                author: entry.userId || "system",
                created_at: entry.timestamp || new Date().toISOString(),
                source_name: "User Feedback",
              },
              keywords: ["failed_query", "feedback", ...entry.message.toLowerCase().split(/\W+/).filter(Boolean)],
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[RAG] Failed to load approved feedback on startup:", (err as Error).message);
  }

  const col = await getChromaCollection();

  if (col) {
    console.log("Setting up ChromaDB Vector DB...");
    const existing = await col.count();

    if (existing === 0) {
      await col.add({
        ids: knowledgeDocuments.map(d => d.id),
        documents: knowledgeDocuments.map(d => d.text),
        metadatas: knowledgeDocuments.map(d => ({ ...d.metadata, category: d.metadata.category })),
      });
      console.log(`[VectorDB] ChromaDB setup complete. Added ${knowledgeDocuments.length} documents.`);
    } else {
      console.log(`[VectorDB] ChromaDB already contains ${existing} documents.`);
    }
  } else {
    console.log(`[VectorDB] In-Memory DB ready. ${knowledgeDocuments.length} documents loaded.`);
  }

  return true;
}

export async function searchKnowledgeBase(
  query: string,
  agentRole: string = "FinanceAgent",
  limit: number = 3,
  userId?: string
): Promise<{ documents: string[][]; metadatas: any[][] }> {
  return searchKnowledgeBaseWithFilter({ query, agentRole, limit, userId });
}

export async function searchKnowledgeBaseWithFilter(
  params: {
    query: string;
    agentRole?: string;
    limit?: number;
    filter?: SelfQueryFilter;
    userId?: string;
  }
): Promise<{ documents: string[][]; metadatas: any[][] }> {
  const { query, agentRole, limit, filter, userId } = {
    agentRole: "FinanceAgent",
    limit: 3,
    ...params
  };
  console.log(`[RAG] Agent="${agentRole}" searching: "${query}"${filter ? ` | self-query: ${JSON.stringify(filter)}` : ""}${userId ? ` | user: ${userId}` : ""}`);

  let categories = ROLE_CATEGORY_MAP[agentRole] || ["finance", "business_policy"];

  if (filter?.categories && filter.categories.length > 0) {
    categories = categories.filter(c => filter.categories!.includes(c));
    if (categories.length === 0) categories = filter.categories;
  }
  const departmentFilter = filter?.departments?.filter(Boolean) || [];

  const col = await getChromaCollection();

  if (col) {
    try {
      const conditions: any[] = [
        { category: { "$in": categories } }
      ];
      if (departmentFilter.length > 0) {
        conditions.push({ department: { "$in": departmentFilter } });
      }
      if (userId) {
        conditions.push({
          "$or": [
            { author: "admin" },
            { author: "system" },
            { author: userId }
          ]
        });
      } else {
        conditions.push({
          "$or": [
            { author: "admin" },
            { author: "system" }
          ]
        });
      }
      const chromaWhere = conditions.length > 1 ? { "$and": conditions } : conditions[0];

      const results = await col.query({
        queryTexts: [query],
        nResults: limit * 2,
        where: chromaWhere,
      });
      console.log(`[RAG] ChromaDB returned ${results.documents[0]?.length || 0} results`);
      if (results.documents[0]?.length > 0) {
        let matched: any[] = [];
        results.documents[0].forEach((text: string, i: number) => {
          const meta = results.metadatas[0][i] || {};
          const author = meta.author;
          const allowed = userId
            ? (!author || author === "admin" || author === "system" || author === userId)
            : (!author || author === "admin" || author === "system");
          if (allowed) {
            matched.push({ text, meta });
          }
        });
        
        matched = matched.slice(0, limit);

        if (matched.length > 0) {
          const formatted = matched.map(m => {
            const source = m.meta.source_name ? `[Source: ${m.meta.source_name}]` : "";
            const dept = m.meta.department ? `(${m.meta.department})` : "";
            return `${source}${dept ? " " + dept : ""}\n${m.text}`;
          });
          return {
            documents: [formatted],
            metadatas: [matched.map(m => m.meta)],
          };
        }
      }
    } catch (err) {
      console.warn("[RAG] ChromaDB query failed, falling back to in-memory:", (err as Error).message);
    }
  }

  let results = recursiveSearch(query, limit, categories, userId);

  if (departmentFilter.length > 0 && results.length > 0) {
    results = results.filter(r => departmentFilter.includes(r.metadata.department));
  }

  if (filter?.year && results.length > 0) {
    results = results.filter(r => {
      if (!r.metadata.created_at) return true;
      return r.metadata.created_at.startsWith(String(filter.year));
    });
  }

  if (results.length === 0 && departmentFilter.length > 0) {
    results = recursiveSearch(query, limit, categories, userId);
  }

  const docs = formatWithSource(results);
  console.log(`[RAG] In-memory returned ${results.length} results for ${agentRole}`);

  return {
    documents: [results.map(r => r.text)],
    metadatas: [results.map(r => r.metadata)],
  };
}

/**
 * Self-Querying: Uses LLM to extract structured metadata filters from a natural language query.
 * Pass an LLM `.invoke()` function as `llmInvoke`.
 */
export async function selfQueryTransform(
  query: string,
  llmInvoke: (prompt: string) => Promise<string>
): Promise<SelfQueryFilter> {
  const systemPrompt = `Extract search filters from the user's query. Return ONLY a JSON object with these fields:
- "query": the core search query (remove date/year references, keep the main subject)
- "categories": array of relevant categories from: finance, technical, business_policy, data_catalog, previous_analysis
- "departments": array of relevant departments if mentioned (e.g. sales, engineering, analytics, security, retention)
- "year": 4-digit year if a specific year is mentioned (e.g. 2024, 2025)

Examples:
Input: "2024 оны маркетингийн тайланг харуул"
Output: {"query":"маркетингийн тайлан","categories":["finance","business_policy"],"departments":[],"year":2024}

Input: "SQL бичихдээ ILIKE хэрхэн ашиглах вэ"
Output: {"query":"ILIKE SQL usage","categories":["technical"],"departments":["engineering"],"year":null}

Input: "Борлуулалтын KPI ямар байна"
Output: {"query":"sales KPI","categories":["finance"],"departments":["sales"],"year":null}

If unsure, return: {"query":"${query.replace(/"/g, "'")}","categories":[],"departments":[],"year":null}
Respond with ONLY the JSON. No markdown, no explanation.`;

  try {
    const response = await llmInvoke(systemPrompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        query: parsed.query || query,
        categories: Array.isArray(parsed.categories) ? parsed.categories : [],
        departments: Array.isArray(parsed.departments) ? parsed.departments : [],
        year: typeof parsed.year === "number" ? parsed.year : undefined,
      };
    }
  } catch (err) {
    console.warn("[RAG] Self-query transform failed:", (err as Error).message);
  }

  return { query };
}

export async function removeDocumentsByPrefix(idPrefix: string): Promise<number> {
  const before = knowledgeDocuments.length;
  const removedIds: string[] = [];
  knowledgeDocuments = knowledgeDocuments.filter(d => {
    const match = d.id.startsWith(idPrefix);
    if (match) removedIds.push(d.id);
    return !match;
  });
  const removed = before - knowledgeDocuments.length;

  const col = await getChromaCollection();
  if (col && removedIds.length > 0) {
    try {
      await col.delete(removedIds);
      console.log(`[RAG] Deleted ${removedIds.length} ChromaDB docs by id (prefix: ${idPrefix})`);
    } catch (err: any) {
      console.warn(`[RAG] ChromaDB delete failed for prefix ${idPrefix}:`, err.message);
    }
  }

  if (removed > 0) {
    console.log(`[RAG] Removed ${removed} documents with id prefix "${idPrefix}"`);
  }
  return removed;
}

export async function addDocumentToCatalog(
  id: string,
  text: string,
  metadata: {
    category: "finance" | "technical" | "business_policy" | "data_catalog" | "previous_analysis";
    department?: string;
    author?: string;
    source_name?: string;
  },
  keywords: string[]
) {
  const doc: RagDocument = {
    id,
    text,
    metadata: {
      category: metadata.category,
      department: metadata.department || "general",
      author: metadata.author || "system",
      created_at: new Date().toISOString(),
      source_name: metadata.source_name || `Upload: ${id}`,
    },
    keywords,
  };

  knowledgeDocuments.push(doc);
  console.log(`[RAG] Added document: ${id} (${metadata.category})`);

  const col = await getChromaCollection();
  if (col) {
    try {
      await col.add({
        ids: [id],
        documents: [text],
        metadatas: [{ ...doc.metadata, category: doc.metadata.category }],
      });
      console.log(`[RAG] Successfully added ${id} to ChromaDB [OK]`);
    } catch (err: any) {
      console.error(`[RAG] Failed to add ${id} to ChromaDB:`, err.message);
    }
  }
}
