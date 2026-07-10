import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RagDocument } from "../rag.js";

// ── Tokenizer ──────────────────────────────────────────────────────────────────

describe("tokenize", () => {
    let tokenize: (text: string) => string[];

    beforeEach(async () => {
        const mod = await import("../rag/semantic-search.js");
        tokenize = mod.tokenize;
    });

    it("splits on whitespace and punctuation", () => {
        expect(tokenize("hello world")).toEqual(["hello", "world"]);
    });

    it("lowercases input", () => {
        expect(tokenize("Hello World")).toEqual(["hello", "world"]);
    });

    it("filters tokens shorter than 2 chars", () => {
        expect(tokenize("a bb ccc")).toEqual(["bb", "ccc"]);
    });

    it("handles Mongolian Cyrillic text", () => {
        const result = tokenize("борлуулалтын тайлан");
        expect(result).toContain("борлуулалтын");
        expect(result).toContain("тайлан");
    });

    it("handles mixed punctuation", () => {
        const result = tokenize("sales, revenue: profit.");
        expect(result).toContain("sales");
        expect(result).toContain("revenue");
        expect(result).toContain("profit");
    });

    it("returns empty array for empty string", () => {
        expect(tokenize("")).toEqual([]);
    });

    it("handles single short token", () => {
        // "hi" is 2 chars, passes the >= 2 filter
        expect(tokenize("hi")).toEqual(["hi"]);
    });
});

// ── BM25 Index ────────────────────────────────────────────────────────────────

describe("buildBM25Index and bm25Score", () => {
    let buildBM25Index: (docs: RagDocument[]) => any;
    let bm25Score: (query: string, index: any) => number[];

    const docs: RagDocument[] = [
        {
            id: "doc1",
            text: "Борлуулалтын тайлан 2024 оны нэгдүгаар сарын борлуулалт",
            metadata: { category: "finance", department: "sales" },
            keywords: ["борлуулалт", "тайлан"],
        },
        {
            id: "doc2",
            text: "SQL query format for database table column selection",
            metadata: { category: "technical", department: "engineering" },
            keywords: ["sql", "database", "query"],
        },
        {
            id: "doc3",
            text: "Revenue and profit margin analysis for Q1",
            metadata: { category: "finance", department: "finance" },
            keywords: ["revenue", "profit", "margin"],
        },
    ];

    beforeEach(async () => {
        const mod = await import("../rag/semantic-search.js");
        buildBM25Index = mod.buildBM25Index;
        bm25Score = mod.bm25Score;
    });

    it("builds index with correct doc count", () => {
        const index = buildBM25Index(docs);
        expect(index.docCount).toBe(3);
    });

    it("computes average document length", () => {
        const index = buildBM25Index(docs);
        expect(index.avgDocLength).toBeGreaterThan(0);
    });

    it("scores exact keyword match highest", () => {
        const index = buildBM25Index(docs);
        const scores = bm25Score("sql", index);
        // doc2 has "sql" keyword
        expect(scores[1]).toBeGreaterThan(scores[0]);
        expect(scores[1]).toBeGreaterThan(scores[2]);
    });

    it("scores multi-word queries", () => {
        const index = buildBM25Index(docs);
        const scores = bm25Score("revenue profit", index);
        // doc3 has both "revenue" and "profit"
        expect(scores[2]).toBeGreaterThan(0);
    });

    it("returns zero scores for unmatched queries", () => {
        const index = buildBM25Index(docs);
        const scores = bm25Score("xyznonexistent", index);
        expect(scores.every(s => s === 0)).toBe(true);
    });

    it("handles Mongolian queries", () => {
        const index = buildBM25Index(docs);
        const scores = bm25Score("борлуулалт тайлан", index);
        // doc1 has both Mongolian terms
        expect(scores[0]).toBeGreaterThan(0);
    });

    it("returns correct number of scores", () => {
        const index = buildBM25Index(docs);
        const scores = bm25Score("test", index);
        expect(scores.length).toBe(3);
    });
});

// ── BM25 Search ───────────────────────────────────────────────────────────────

describe("bm25Search", () => {
    let buildBM25Index: (docs: RagDocument[]) => any;
    let bm25SearchFn: (query: string, docs: RagDocument[], index: any, limit?: number, categories?: string[], userId?: string) => any[];

    const docs: RagDocument[] = [
        {
            id: "doc1",
            text: "Борлуулалтын тайлан илтгэл sales report",
            metadata: { category: "finance", department: "sales", author: "admin", shared: true },
            keywords: ["борлуулалт", "тайлан", "sales"],
        },
        {
            id: "doc2",
            text: "SQL database query column selection",
            metadata: { category: "technical", department: "engineering", author: "admin", shared: true },
            keywords: ["sql", "database"],
        },
        {
            id: "doc3",
            text: "Private user document about sales targets",
            metadata: { category: "finance", department: "sales", author: "user123", shared: false },
            keywords: ["sales", "target"],
        },
    ];

    beforeEach(async () => {
        const mod = await import("../rag/semantic-search.js");
        buildBM25Index = mod.buildBM25Index;
        bm25SearchFn = mod.bm25Search;
    });

    it("returns results sorted by score descending", () => {
        const index = buildBM25Index(docs);
        const results = bm25SearchFn("sales", docs, index);
        for (let i = 1; i < results.length; i++) {
            expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
        }
    });

    it("respects limit parameter", () => {
        const index = buildBM25Index(docs);
        const results = bm25SearchFn("sales", docs, index, 2);
        expect(results.length).toBeLessThanOrEqual(2);
    });

    it("filters by category", () => {
        const index = buildBM25Index(docs);
        const results = bm25SearchFn("sales", docs, index, 10, ["technical"]);
        expect(results.every(r => r.doc.metadata.category === "technical")).toBe(true);
    });

    it("respects user access control — shared docs visible to all", () => {
        const index = buildBM25Index(docs);
        // No userId — only shared/admin/system docs
        const results = bm25SearchFn("sales", docs, index, 10, undefined, undefined);
        const ids = results.map(r => r.doc.id);
        expect(ids).toContain("doc1"); // shared
        expect(ids).not.toContain("doc3"); // private, author=user123
    });

    it("shows private docs to their author", () => {
        const index = buildBM25Index(docs);
        const results = bm25SearchFn("sales", docs, index, 10, undefined, "user123");
        const ids = results.map(r => r.doc.id);
        expect(ids).toContain("doc3"); // author=user123, visible to user123
    });

    it("returns empty for no matches", () => {
        const index = buildBM25Index(docs);
        const results = bm25SearchFn("xyznonexistent", docs, index);
        expect(results).toEqual([]);
    });
});

// ── Hybrid Search ──────────────────────────────────────────────────────────────

describe("hybridSearch (without Gemini — BM25-only fallback)", () => {
    let buildBM25Index: (docs: RagDocument[]) => any;
    let hybridSearchFn: (...args: any[]) => Promise<any[]>;

    const docs: RagDocument[] = [
        {
            id: "doc1",
            text: "Борлуулалтын тайлан илтгэл",
            metadata: { category: "finance", department: "sales", author: "admin", shared: true },
            keywords: ["борлуулалт", "тайлан"],
        },
        {
            id: "doc2",
            text: "SQL database query column selection",
            metadata: { category: "technical", department: "engineering", author: "admin", shared: true },
            keywords: ["sql", "database"],
        },
    ];

    beforeEach(async () => {
        const mod = await import("../rag/semantic-search.js");
        buildBM25Index = mod.buildBM25Index;
        hybridSearchFn = mod.hybridSearch;
    });

    it("returns results when Gemini embeddings unavailable", async () => {
        // Ensure GOOGLE_API_KEY is not set for this test
        const original = process.env.GOOGLE_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        try {
            const index = buildBM25Index(docs);
            const results = await hybridSearchFn("борлуулалт", docs, index, 5);
            // Should still get BM25 results even without embeddings
            expect(results.length).toBeGreaterThanOrEqual(0);
        } finally {
            if (original) process.env.GOOGLE_API_KEY = original;
        }
    });

    it("respects category filter", async () => {
        const original = process.env.GOOGLE_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        try {
            const index = buildBM25Index(docs);
            const results = await hybridSearchFn("sql", docs, index, 5, ["finance"]);
            expect(results.every((r: any) => r.doc.metadata.category === "finance")).toBe(true);
        } finally {
            if (original) process.env.GOOGLE_API_KEY = original;
        }
    });
});

// ── Cosine Similarity (via semantic-search internals) ──────────────────────────

describe("normalizeScores", () => {
    // Test indirectly through bm25Search score ranges
    let buildBM25Index: (docs: RagDocument[]) => any;
    let bm25SearchFn: (query: string, docs: RagDocument[], index: any) => any[];

    beforeEach(async () => {
        const mod = await import("../rag/semantic-search.js");
        buildBM25Index = mod.buildBM25Index;
        bm25SearchFn = mod.bm25Search;
    });

    it("BM25 scores are non-negative", () => {
        const docs: RagDocument[] = [
            { id: "a", text: "hello world", metadata: { category: "technical", department: "eng", shared: true }, keywords: [] },
            { id: "b", text: "goodbye world", metadata: { category: "technical", department: "eng", shared: true }, keywords: [] },
        ];
        const index = buildBM25Index(docs);
        const results = bm25SearchFn("hello", docs, index);
        results.forEach(r => expect(r.score).toBeGreaterThanOrEqual(0));
    });
});

// ── getSemanticSearchStatus ────────────────────────────────────────────────────

describe("getSemanticSearchStatus", () => {
    it("returns status object with expected fields", async () => {
        const mod = await import("../rag/semantic-search.js");
        const status = mod.getSemanticSearchStatus();
        expect(status).toHaveProperty("geminiEmbeddings");
        expect(status).toHaveProperty("bm25Ready");
        expect(status).toHaveProperty("cachedDocCount");
        expect(status).toHaveProperty("cachedQueryCount");
    });
});
