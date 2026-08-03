/**
 * rag-retrieval.test.ts — RAG pipeline retrieval integration tests.
 *
 * Covers:
 *  A) Vector fallback: search degrades to in-memory BM25 when ChromaDB + embeddings are unavailable.
 *  B) Semantic match: a mocked ChromaDB retrieval surfaces the finance_combined passport for an
 *     English semantic query (no keyword overlap).
 *  C) Top-K & threshold: the ChromaDB path respects `limit` and sorts by blended score (with the
 *     distance→score clamp); `hybridSearch` discards BM25-unmatched docs below its semantic threshold.
 *
 * Uses real glossary / passport payloads from disk (no DB or network I/O).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import yaml from "yaml";

// Mock the ChromaDB client so we can control availability per-test.
// The real module returns null anyway when CHROMA_URL/OPENAI_API_KEY are unset;
// mocking lets us also exercise the active ChromaDB branch deterministically.
vi.mock("../rag/chroma-client.js", () => ({
  getChromaCollection: vi.fn().mockResolvedValue(null),
}));

import type { RagDocument } from "../rag.js";
import {
  searchKnowledgeBaseWithFilter,
  clearRagResultCache,
  clearQueryExpansionCache,
} from "../rag/hybrid-search.js";
import { getChromaCollection } from "../rag/chroma-client.js";
import { hybridSearch, buildBM25Index } from "../rag/semantic-search.js";
import { setKnowledgeDocuments, setBm25Index } from "../rag/knowledge-base.js";

function loadGlossaryDocs(): RagDocument[] {
  const raw = readFileSync("src/rag/finance-glossary.yaml", "utf-8");
  const parsed = yaml.parse(raw);
  return (parsed.terms as any[]).map((term, i) => ({
    id: `finance-glossary-${i}`,
    text: `${term.term}: ${term.definition}`,
    metadata: {
      category: "finance",
      department: "finance",
      author: "system",
      source_name: "finance-glossary",
      shared: true,
    },
    keywords: [term.term.toLowerCase(), ...(term.tags || [])],
  }));
}

function loadPassportDocs(): RagDocument[] {
  const content = readFileSync("docs/passports/finance_combined.md", "utf-8");
  return [
    {
      id: "passport_finance_combined",
      text: content,
      metadata: {
        category: "data_catalog",
        department: "analytics",
        author: "system",
        source_name: "passport_finance_combined",
        shared: true,
      },
      keywords: ["passport", "finance_combined"],
    },
  ];
}

function seedKnowledgeBase(docs: RagDocument[]): void {
  setKnowledgeDocuments(docs);
  setBm25Index(buildBM25Index(docs));
}

function fakeChromaCollection(response: unknown): any {
  return {
    query: vi.fn().mockResolvedValue(response),
  };
}

beforeEach(() => {
  // Force the "unavailable" posture so nothing hits real APIs / DB.
  vi.stubEnv("CHROMA_URL", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GOOGLE_API_KEY", "");
  vi.stubEnv("GEMINI_EMBEDDING_MODEL", "");
  vi.mocked(getChromaCollection).mockResolvedValue(null);
  clearRagResultCache();
  clearQueryExpansionCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── T1: Vector Fallback (no mocks on the search path) ─────────────────────────

describe("RAG vector fallback", () => {
  it("T1: returns a known glossary term via in-memory BM25 when ChromaDB/embeddings are unavailable", async () => {
    const docs = [...loadGlossaryDocs(), ...loadPassportDocs()];
    seedKnowledgeBase(docs);

    const result = await searchKnowledgeBaseWithFilter({
      query: "НӨАТ",
      agentRole: "FinanceAgent",
      limit: 5,
    });

    expect(result.documents[0].length).toBeGreaterThan(0);
    // The in-memory path returns RAW text (no `[Source:]` prefix — only the ChromaDB
    // path adds citation markers; see the audit notes). Verify the glossary hit via metadata.
    const hitMeta = result.metadatas[0][0] as { source_name?: string };
    expect(hitMeta.source_name).toBe("finance-glossary");
    expect(result.documents[0][0].toLowerCase()).toContain("нөат");
  });

  it("T1b: recovers the finance_combined passport via BM25 for a TechAgent (keyword overlap)", async () => {
    const docs = [...loadGlossaryDocs(), ...loadPassportDocs()];
    seedKnowledgeBase(docs);

    const result = await searchKnowledgeBaseWithFilter({
      query: "Түрээс",
      agentRole: "TechAgent", // tech/data_catalog — passports are data_catalog
      limit: 5,
    });

    expect(result.documents[0].length).toBeGreaterThan(0);
    const joined = result.documents[0].join("\n").toLowerCase();
    // BM25 token match on the Mongolian expense term.
    expect(joined).toContain("түрээс");
  });
});

// ── T2: Semantic match via mocked ChromaDB ────────────────────────────────────

describe("RAG semantic retrieval (ChromaDB mocked)", () => {
  it("T2: retrieves the finance_combined_passport for an English semantic query", async () => {
    const passportText = loadPassportDocs()[0].text;

    vi.mocked(getChromaCollection).mockResolvedValue(
      fakeChromaCollection({
        documents: [[passportText]],
        metadatas: [[
          {
            source_name: "passport_finance_combined",
            category: "finance",
            department: "analytics",
            author: "system",
            shared: true,
            created_at: new Date().toISOString(),
          },
        ]],
        distances: [[0.15]],
      }) as any,
    );

    const result = await searchKnowledgeBaseWithFilter({
      query: "how much did we spend on rent?",
      agentRole: "FinanceAgent",
      limit: 3,
    });

    // The English query shares no tokens with the Mongolian passport — only a
    // vector match can discover it. The ChromaDB branch + score blend must return it.
    expect(result.documents[0].length).toBeGreaterThan(0);
    expect(result.documents[0][0]).toContain("[Source: passport_finance_combined]");
  });

  it("T2b: respects limit and emits descending-score order with distinct results", async () => {
    const grText = (i: number) =>
      `document chunk ${i}: the rent expense line item for lease payments.`;
    const sources = ["s_a", "s_b", "s_c", "s_d", "s_e"];
    const distances = [0.05, 0.25, 0.55, 0.9, 1.6];

    vi.mocked(getChromaCollection).mockResolvedValue({
      query: vi.fn().mockResolvedValue({
        documents: [sources.map((_, i) => grText(i))],
        metadatas: [[
          ...sources.map((s) => ({
            source_name: s,
            category: "finance",
            department: "general",
            author: "system",
            shared: true,
            created_at: new Date().toISOString(),
          })),
        ]],
        distances: [[...distances]],
      }),
    } as any);

    const result = await searchKnowledgeBaseWithFilter({
      query: "lease payments on the railway",
      agentRole: "FinanceAgent",
      limit: 3,
    });

    expect(result.documents[0].length).toBeLessThanOrEqual(3);
    // Smallest distance → highest vector similarity → top of the blended ranking.
    expect((result.metadatas[0][0] as { source_name?: string }).source_name).toBe("s_a");
    // Distance 1.6 → vectorScore clamps to 0; it must not outrank closeness matches.
    const returned = (result.metadatas[0] as Array<{ source_name: string }>).map((m) => m.source_name);
    // s_a, s_b, s_c (0.05/0.25/0.55) should dominate; s_e (1.6) must be excluded at top-3.
    expect(returned).not.toContain("s_e");
  });
});

// ── T3: Top-K and relevance threshold in hybridSearch ─────────────────────────

describe("RAG hybridSearch top-K & threshold", () => {
  const rentDoc: RagDocument = {
    id: "d_rent",
    text: "Түрээсийн зарлага: сарын түрээс 25.2M₮. Түрээс is lease expense.",
    metadata: {
      category: "finance",
      department: "general",
      author: "system",
      source_name: "d_rent",
      shared: true,
      created_at: new Date().toISOString(),
    },
    keywords: ["түрээс", "rent"],
  };
  const salaryDoc: RagDocument = {
    id: "d_salary",
    text: "Цалингийн зарлага: сарын цалин нийт 77.8M₮.",
    metadata: {
      category: "finance",
      department: "general",
      author: "system",
      source_name: "d_salary",
      shared: true,
      created_at: new Date().toISOString(),
    },
    keywords: ["цалин"],
  };

  it("T3: keyword-overlap query ranks the matching doc first", async () => {
    const docs = [rentDoc, salaryDoc];
    const idx = buildBM25Index(docs);

    // Exact token match — BM25 tokenizer has no substring matching, so use the
    // actual term that appears verbatim in d_rent ("Түрээс" + keyword "түрээс").
    const results = await hybridSearch("Түрээс", docs, idx, 5, ["finance"]);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].doc.id).toBe("d_rent");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("T3: no token overlap → BM25-empty docs are dropped below MIN_SEMANTIC_THRESHOLD", async () => {
    const docs = [rentDoc, salaryDoc];
    const idx = buildBM25Index(docs);

    // No shared tokens with either doc and no embeddings available → below threshold.
    const results = await hybridSearch("zxqzz unknown_noise", docs, idx, 5, ["finance"]);

    expect(results).toEqual([]);
  });

  it("T3: hybrid search respects the limit (top-k) while staying ranked", async () => {
    const docs = [rentDoc, salaryDoc];
    const idx = buildBM25Index(docs);

    // Both docs match tokens of this query; limit 1 must truncate to a single result.
    const results = await hybridSearch("цалин Түрээс", docs, idx, 1, ["finance"]);

    expect(results.length).toBe(1);
    expect(results[0].score).toBeGreaterThan(0);
  });
});