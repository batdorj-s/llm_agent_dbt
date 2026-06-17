import dotenv from "dotenv";
dotenv.config();

// ─────────────────────────────────────────────────────────────
// Knowledge Base Documents
// ─────────────────────────────────────────────────────────────
export let knowledgeDocuments = [
  {
    id: "doc1",
    text: "Business Glossary: 'Sales' refers to the total revenue generated from closed deals, calculated from the active Data Lake dataset's revenue or amount column. The current annual target is set to 500,000 USD.",
    metadata: { category: "glossary", department: "sales" },
    keywords: ["sales", "revenue", "target", "deals", "finance", "dataset"]
  },
  {
    id: "doc2",
    text: "Business Glossary: 'Churn Rate' is the percentage of users who have not made a purchase in over 6 months. The acceptable threshold is under 2.0%.",
    metadata: { category: "glossary", department: "retention" },
    keywords: ["churn", "users", "cancel", "subscription", "retention", "percentage"]
  },
  {
    id: "doc3",
    text: "Policy: The Enterprise AI Orchestrator uses a unified Admin access model. All authenticated users have full access to SQL analysis, Python sandboxing, and KPI management.",
    metadata: { category: "policy", department: "security" },
    keywords: ["policy", "rbac", "admin", "access", "security", "compliance", "data", "unified"]
  },
  {
    id: "doc4",
    text: "Data Lake Catalog: Use the active uploaded table from the catalog for transaction analytics. Always read the live schema before writing SQL, and do not assume older table names or columns unless they appear in the current catalog.",
    metadata: { category: "catalog", department: "analytics" },
    keywords: ["catalog", "columns", "date", "sales", "category", "data lake", "sqlite", "sql", "schema"]
  },
  {
    id: "doc5",
    text: "Data Lake Catalog: Historical trend analysis should use the live catalog entry for the currently loaded dataset. If dates contain dots, normalize them with REPLACE(column, '.', '-') before date grouping.",
    metadata: { category: "catalog", department: "analytics" },
    keywords: ["catalog", "columns", "order_date", "sales", "category", "region", "data lake", "sqlite", "sql", "date"]
  }
];

export const mockDocuments = knowledgeDocuments;

// ─────────────────────────────────────────────────────────────
// Improved In-Memory Search (keyword scoring)
// ─────────────────────────────────────────────────────────────
function inMemorySearch(query: string, limit: number) {
  const queryWords = query.toLowerCase().split(/\W+/).filter(Boolean);

  const scored = knowledgeDocuments.map(doc => {
    const score = queryWords.reduce((acc, word) => {
      if (doc.keywords.includes(word)) return acc + 2;          // Exact keyword match
      if (doc.text.toLowerCase().includes(word)) return acc + 1; // Partial text match
      return acc;
    }, 0);
    return { doc, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.doc);
}

// ─────────────────────────────────────────────────────────────
// ChromaDB + OpenAI Embedding Setup (when env vars available)
// ─────────────────────────────────────────────────────────────
let chromaClient: any = null;
let collection: any = null;

async function getChromaCollection() {
  if (collection) return collection; // Cached

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

    console.log("[VectorDB] ChromaDB collection ready ✅");
    return collection;
  } catch (err) {
    console.warn("[VectorDB] ChromaDB unavailable, using in-memory fallback:", (err as Error).message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Setup — Seed Documents into ChromaDB (if available)
// ─────────────────────────────────────────────────────────────
export async function setupKnowledgeBase() {
  const col = await getChromaCollection();

  if (col) {
    console.log("Setting up ChromaDB Vector DB...");
    const existing = await col.count();

    if (existing === 0) {
      await col.add({
        ids: knowledgeDocuments.map(d => d.id),
        documents: knowledgeDocuments.map(d => d.text),
        metadatas: knowledgeDocuments.map(d => d.metadata),
      });
      console.log(`✅ ChromaDB setup complete. Added ${knowledgeDocuments.length} documents.`);
    } else {
      console.log(`✅ ChromaDB already contains ${existing} documents.`);
    }
  } else {
    console.log("Setting up In-Memory Vector DB (ChromaDB/OpenAI unavailable)...");
    console.log(`✅ In-Memory DB ready. ${knowledgeDocuments.length} documents loaded.`);
  }

  return true;
}

// ─────────────────────────────────────────────────────────────
// Search — Semantic (ChromaDB) or Keyword (In-Memory fallback)
// ─────────────────────────────────────────────────────────────
export async function searchKnowledgeBase(query: string, limit: number = 2) {
  console.log(`[VectorDB] Searching for: "${query}"`);

  const col = await getChromaCollection();

  if (col) {
    try {
      // Genuine semantic vector search
      const results = await col.query({
        queryTexts: [query],
        nResults: limit,
      });
      console.log(`[VectorDB] ChromaDB returned ${results.documents[0].length} results`);
      return results;
    } catch (err) {
      console.warn("[VectorDB] ChromaDB query failed, falling back to in-memory:", (err as Error).message);
    }
  }

  // Improved keyword-scored in-memory fallback
  const results = inMemorySearch(query, limit);
  const fallback = results.length > 0 ? results : [knowledgeDocuments[0]];

  console.log(`[VectorDB] In-memory returned ${fallback.length} results`);
  return {
    documents: [fallback.map(r => r.text)],
    metadatas: [fallback.map(r => r.metadata)],
  };
}

// ─────────────────────────────────────────────────────────────
// Dynamic document addition (API Upload feature)
// ─────────────────────────────────────────────────────────────
export async function addDocumentToCatalog(id: string, text: string, metadata: any, keywords: string[]) {
  console.log(`[VectorDB] Adding new document: ${id}`);
  knowledgeDocuments.push({ id, text, metadata, keywords });

  const col = await getChromaCollection();
  if (col) {
    try {
      await col.add({
        ids: [id],
        documents: [text],
        metadatas: [metadata],
      });
      console.log(`[VectorDB] Successfully added document ${id} to ChromaDB ✅`);
    } catch (err: any) {
      console.error(`[VectorDB] Failed to add document ${id} to ChromaDB:`, err.message);
    }
  } else {
    console.log(`[VectorDB] Added document ${id} to In-Memory DB ✅`);
  }
}
