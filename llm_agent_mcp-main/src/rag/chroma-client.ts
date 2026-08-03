/**
 * chroma-client.ts — Lazy ChromaDB connection and collection singleton.
 *
 * Uses the Gemini embedder (gemini-embedding-001) as the collection embedding
 * function, consistent with the rest of the RAG stack (semantic-search.ts).
 * chromadb v3 dropped the named `OpenAIEmbeddingFunction` constructor, so the
 * embedding function is implemented locally and passed to getOrCreateCollection.
 */

import { getGeminiEmbedder } from "./semantic-search.js";

const COLLECTION_NAME = "enterprise-kb";

let chromaClient: any = null;
let collection: any = null;

/**
 * Gemini-backed embedding function for ChromaDB. Chroma serializes this as a
 * "legacy" (client-side) embedding function: add()/query() embed texts locally
 * via the `generate` implementation before talking to the server.
 */
function createGeminiEmbeddingFunction(): any {
  const BATCH_SIZE = 50; // Gemini batch embed limit; oversized batches return empty vectors
  return {
    name: "gemini",
    defaultSpace: () => "cosine" as const,
    async generate(texts: string[]): Promise<number[][]> {
      const embedder = await getGeminiEmbedder();
      if (!embedder) throw new Error("Gemini embedder not available");

      const out: number[][] = [];
      let dim = 0;
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const vectors = await embedder.embedDocuments(batch);
        for (const v of vectors) {
          if (Array.isArray(v) && v.length > 0) {
            if (!dim) dim = v.length;
            out.push(v);
          } else {
            // Degenerate text / API miss — keep indices aligned with a zero vector
            // so ChromaDB accepts the batch (empty embeddings are rejected).
            out.push(new Array(dim || 768).fill(0));
          }
        }
      }
      return out;
    },
  };
}

export async function getChromaCollection(): Promise<any> {
  if (collection) return collection;

  const hasChromaUrl = !!process.env.CHROMA_URL;
  const hasGoogleKey = !!process.env.GOOGLE_API_KEY &&
    !process.env.GOOGLE_API_KEY.startsWith("your_");

  // Never touch external ChromaDB under tests: importers that run full app
  // bootstrap (e.g. upload-endpoints) call dotenv.config() and would otherwise
  // write test fixtures into the production collection, causing cross-file
  // interference and flaky suites.
  if (process.env.NODE_ENV === "test") {
    console.debug(`[VectorDB][Debug] ChromaDB skipped in NODE_ENV=test — in-memory fallback`);
    return null;
  }

  console.debug(`[VectorDB][Debug] getChromaCollection() → CHROMA_URL=${hasChromaUrl} | GOOGLE_API_KEY=${hasGoogleKey}`);

  if (!hasChromaUrl || !hasGoogleKey) {
    console.debug(`[VectorDB][Debug] ChromaDB disabled (${!hasChromaUrl ? "missing CHROMA_URL" : "missing GOOGLE_API_KEY"}) — in-memory fallback`);
    return null;
  }

  try {
    const { ChromaClient } = await import("chromadb") as any;

    console.debug(`[VectorDB][Debug] Connecting to ChromaDB at ${process.env.CHROMA_URL} (embedder: gemini-embedding-001)...`);
    chromaClient = new ChromaClient({ path: process.env.CHROMA_URL });

    collection = await chromaClient.getOrCreateCollection({
      name: COLLECTION_NAME,
      embeddingFunction: createGeminiEmbeddingFunction(),
      metadata: { "hnsw:space": "cosine" },
    });

    console.log("[VectorDB] ChromaDB collection ready [OK]");
    return collection;
  } catch (err) {
    console.warn("[VectorDB] ChromaDB unavailable, using in-memory fallback:", (err as Error).message);
    return null;
  }
}