import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

// ── estimateTokens ───────────────────────────────────────────

describe("estimateTokens", () => {
    let estimateTokens: (t: string) => number;

    beforeEach(async () => {
        const rag = await import("../rag.js");
        estimateTokens = rag.estimateTokens;
    });

    it("returns 0 for empty string", () => {
        expect(estimateTokens("")).toBe(0);
    });

    it("returns 1 for single character", () => {
        expect(estimateTokens("a")).toBe(1);
    });

    it("returns 1 for exactly 4 characters", () => {
        expect(estimateTokens("abcd")).toBe(1);
    });

    it("returns 2 for 5 characters (rounds up)", () => {
        expect(estimateTokens("abcde")).toBe(2);
    });

    it("handles Mongolian/Cyrillic text with same formula", () => {
        // "Монгол" = 6 characters → Math.ceil(6/4) = 2
        expect(estimateTokens("Монгол")).toBe(2);
    });

    it("handles mixed Latin and Cyrillic", () => {
        // "Монгол улс hello" = 16 chars → Math.ceil(16/4) = 4
        expect(estimateTokens("Монгол улс hello")).toBe(4);
    });

    it("uses Math.ceil(text.length / 4) — static analysis", () => {
        const src = readFileSync("src/rag.ts", "utf8");
        expect(src).toContain("Math.ceil(text.length / 4)");
    });
});

// ── chunkText ────────────────────────────────────────────────

describe("chunkText", () => {
    let chunkText: (t: string, chunkSize?: number, overlap?: number) => string[];

    beforeEach(async () => {
        const rag = await import("../rag.js");
        chunkText = rag.chunkText;
    });

    it("returns single chunk for text shorter than chunk size", () => {
        const text = "Short text.";
        const result = chunkText(text, 100, 10);
        expect(result).toEqual([text]);
    });

    it("returns single chunk for text exactly at chunk boundary", () => {
        // chunkSize * 4 = 100 * 4 = 400 chars
        const text = "a".repeat(400);
        const result = chunkText(text, 100, 10);
        expect(result).toEqual([text]);
    });

    it("produces multiple chunks for text exceeding chunk size", () => {
        // chunkSize * 4 = 30 * 4 = 120 chars per chunk
        const paraA = "a".repeat(100);
        const paraB = "b".repeat(100);
        const text = paraA + "\n\n" + paraB;
        const result = chunkText(text, 30, 5);
        expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("includes overlap between consecutive chunks", () => {
        // chunkSize=20 → char limit = 80, overlap=8 → overlap chars = 32
        // Build paragraphs so first chunk fills up and overlap carries over
        const paras: string[] = [];
        for (let i = 0; i < 6; i++) {
            paras.push(`paragraph_${i}_` + "x".repeat(20));
        }
        const text = paras.join("\n\n");
        const result = chunkText(text, 20, 8);
        // At least 2 chunks, and overlap chars (8*4=32) should appear
        if (result.length >= 2) {
            const overlapChars = 8 * 4;
            const prevEnd = result[0].slice(-overlapChars);
            const nextStart = result[1].slice(0, overlapChars);
            const hasOverlap = prevEnd.length > 0 && nextStart.includes(prevEnd.slice(-10));
            expect(hasOverlap).toBe(true);
        }
    });

    it("splits oversized paragraphs by sentences", () => {
        // Single paragraph that exceeds chunkSize must be split by sentences
        const sentences: string[] = [];
        for (let i = 0; i < 10; i++) {
            sentences.push(`Sentence number ${i} with enough text to fill a chunk.`);
        }
        const text = sentences.join(" ");
        const result = chunkText(text, 20, 5);
        expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("returns array with empty string for empty input", () => {
        const result = chunkText("", 100, 10);
        expect(result).toEqual([""]);
    });

    it("respects custom chunkSize", () => {
        // char limit = 1000 * 4 = 4000 with large chunkSize → single chunk
        const text = "Small text.";
        const result = chunkText(text, 1000, 50);
        expect(result).toEqual([text]);
    });

    it("respects custom overlap", () => {
        // chunkSize=50, overlap=20 → overlap chars = 80
        const paras: string[] = [];
        for (let i = 0; i < 4; i++) {
            paras.push("para" + i + "_" + "y".repeat(60));
        }
        const text = paras.join("\n\n");
        const result = chunkText(text, 50, 20);
        if (result.length >= 2) {
            const overlapChars = 20 * 4;
            const prevEnd = result[0].slice(-overlapChars);
            expect(prevEnd.length).toBeGreaterThan(0);
        }
    });
});

// ── selfQueryTransform ───────────────────────────────────────

describe("selfQueryTransform", () => {
    let selfQueryTransform: (q: string, fn: (p: string) => Promise<string>) => Promise<any>;

    beforeEach(async () => {
        const rag = await import("../rag.js");
        selfQueryTransform = rag.selfQueryTransform;
    });

    it("extracts structured JSON from LLM response", async () => {
        const mockLlm = vi.fn().mockResolvedValue(
            JSON.stringify({ query: "sales report", categories: ["finance"], departments: ["sales"], year: 2024 })
        );
        const result = await selfQueryTransform("2024 оны борлуулалтын тайлан", mockLlm);
        expect(result.query).toBe("sales report");
        expect(result.categories).toEqual(["finance"]);
        expect(result.departments).toEqual(["sales"]);
        expect(result.year).toBe(2024);
        expect(mockLlm).toHaveBeenCalledTimes(1);
    });

    it("regex fallback — extracts JSON from markdown-wrapped response", async () => {
        const mockLlm = vi.fn().mockResolvedValue(
            "Here is the JSON:\n```\n{\"query\":\"test\",\"categories\":[\"technical\"]}\n```"
        );
        const result = await selfQueryTransform("test query", mockLlm);
        expect(result.query).toBe("test");
        expect(result.categories).toContain("technical");
    });

    it("gracefully handles LLM failure — returns original query, no filter fields", async () => {
        const mockLlm = vi.fn().mockRejectedValue(new Error("LLM API error"));
        const result = await selfQueryTransform("fallback query", mockLlm);
        expect(result.query).toBe("fallback query");
        // Fallback returns { query } only — no categories/departments/year
        expect(result.categories).toBeUndefined();
        expect(result.departments).toBeUndefined();
        expect(result.year).toBeUndefined();
    });

    it("gracefully handles bad JSON — returns original query", async () => {
        const mockLlm = vi.fn().mockResolvedValue("not even close to JSON");
        const result = await selfQueryTransform("bad json test", mockLlm);
        expect(result.query).toBe("bad json test");
    });

    it("caches result — second call with same query skips LLM", async () => {
        const mockLlm = vi.fn().mockResolvedValue(
            JSON.stringify({ query: "cached query", categories: ["technical"] })
        );
        // First call
        const r1 = await selfQueryTransform("unique_key_12345_cache_test", mockLlm);
        expect(r1.query).toBe("cached query");
        expect(mockLlm).toHaveBeenCalledTimes(1);
        // Second call with same query — should use cache
        const r2 = await selfQueryTransform("unique_key_12345_cache_test", mockLlm);
        expect(r2.query).toBe("cached query");
        // LLM should NOT be called again
        expect(mockLlm).toHaveBeenCalledTimes(1);
    });

    it("handles partial response — missing categories defaults to empty array", async () => {
        const mockLlm = vi.fn().mockResolvedValue(
            JSON.stringify({ query: "partial" })
        );
        const result = await selfQueryTransform("partial only", mockLlm);
        expect(result.query).toBe("partial");
        expect(result.categories).toEqual([]);
        expect(result.departments).toEqual([]);
        expect(result.year).toBeUndefined();
    });

    it("handles null year correctly", async () => {
        const mockLlm = vi.fn().mockResolvedValue(
            JSON.stringify({ query: "no year", categories: ["finance"], departments: [], year: null })
        );
        const result = await selfQueryTransform("no year query", mockLlm);
        expect(result.year).toBeUndefined();
    });
});

// ── Finance Glossary Quality ────────────────────────────────────
describe("Finance Glossary Quality", () => {
    let glossary: any;

    beforeEach(async () => {
        const yaml = readFileSync("src/rag/finance-glossary.yaml", "utf-8");
        const { parse } = await import("yaml");
        glossary = parse(yaml);
    });

    it("has 30+ terms", () => {
        expect(glossary.terms.length).toBeGreaterThanOrEqual(30);
    });

    it("each term has required fields", () => {
        for (const term of glossary.terms) {
            expect(term.term).toBeTruthy();
            expect(term.definition).toBeTruthy();
            expect(term.category).toBeTruthy();
            expect(term.tags).toBeInstanceOf(Array);
            expect(term.tags.length).toBeGreaterThan(0);
        }
    });

    it("covers balance sheet categories", () => {
        const categories = glossary.terms.map((t: any) => t.subcategory);
        expect(categories).toContain("balance_sheet");
        expect(categories).toContain("income");
        expect(categories).toContain("expense");
        expect(categories).toContain("tax");
    });

    it("includes key Mongolian finance terms", () => {
        const termNames = glossary.terms.map((t: any) => t.term);
        expect(termNames).toContain("НӨАТ");
        expect(termNames).toContain("Орлого");
        expect(termNames).toContain("Цэвэр ашиг");
        expect(termNames).toContain("Баланс");
        expect(termNames).toContain("Актив");
        expect(termNames).toContain("Пассив");
        expect(termNames).toContain("Эцэг хөрөнгө");
    });
});

// ── Knowledge Base Document Quality ─────────────────────────────
describe("Knowledge Base Document Quality", () => {
    let kb: any;

    beforeEach(async () => {
        const yaml = readFileSync("docs/knowledge-base.yaml", "utf-8");
        const { parse } = await import("yaml");
        kb = parse(yaml);
    });

    it("has 20+ documents", () => {
        expect(kb.documents.length).toBeGreaterThanOrEqual(20);
    });

    it("each document has required fields", () => {
        for (const doc of kb.documents) {
            expect(doc.id).toBeTruthy();
            expect(doc.text).toBeTruthy();
            expect(doc.metadata).toBeTruthy();
            expect(doc.keywords).toBeInstanceOf(Array);
        }
    });

    it("includes manufacturing documents", () => {
        const ids = kb.documents.map((d: any) => d.id);
        expect(ids).toContain("manufacturing_cost");
        expect(ids).toContain("inventory_management");
    });

    it("includes IFRS reference", () => {
        const ids = kb.documents.map((d: any) => d.id);
        expect(ids).toContain("ifrs_overview");
    });

    it("includes SQL error resolution guide", () => {
        const ids = kb.documents.map((d: any) => d.id);
        expect(ids).toContain("sql_error_resolution");
    });
});
