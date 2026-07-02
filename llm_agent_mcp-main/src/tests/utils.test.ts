import { describe, it, expect } from "vitest";
import {
    extractJsonFromLlmResponse,
    stripMarkdownFences,
    safeJsonParse,
    buildSemanticGroups,
    formatSemanticGroups,
    queryMentionsTable,
    extractCodeBlock,
    diceSimilarity,
    findClosestColumn,
} from "../utils.js";

describe("extractJsonFromLlmResponse", () => {
    it("extracts JSON from markdown code fence", () => {
        const raw = '```json\n{"name": "test", "value": 42}\n```';
        expect(extractJsonFromLlmResponse(raw)).toBe('{"name": "test", "value": 42}');
    });

    it("extracts JSON from bare code fence (no lang)", () => {
        const raw = '```\n{"key": "val"}\n```';
        expect(extractJsonFromLlmResponse(raw)).toBe('{"key": "val"}');
    });

    it("extracts first JSON object from text", () => {
        const raw = 'Here is the result: {"a": 1, "b": 2} and more text';
        expect(extractJsonFromLlmResponse(raw)).toBe('{"a": 1, "b": 2}');
    });

    it("extracts first JSON array from text", () => {
        const raw = 'Data: [1, 2, 3] end';
        expect(extractJsonFromLlmResponse(raw)).toBe('[1, 2, 3]');
    });

    it("returns empty string for empty input", () => {
        expect(extractJsonFromLlmResponse("")).toBe("");
    });

    it("returns trimmed string when no JSON found", () => {
        expect(extractJsonFromLlmResponse("  hello world  ")).toBe("hello world");
    });

    it("prefers markdown fenced JSON over bare JSON", () => {
        const raw = '```json\n{"correct": true}\n```\n{"wrong": false}';
        expect(extractJsonFromLlmResponse(raw)).toBe('{"correct": true}');
    });
});

describe("stripMarkdownFences", () => {
    it("removes code fence markers but keeps content", () => {
        const raw = 'Some text\n```python\nprint("hello")\n```\nmore text';
        expect(stripMarkdownFences(raw)).toBe('Some text\nprint("hello")\nmore text');
    });

    it("returns unchanged string without fences", () => {
        expect(stripMarkdownFences("plain text")).toBe("plain text");
    });

    it("handles empty string", () => {
        expect(stripMarkdownFences("")).toBe("");
    });

    it("removes language tag from fence", () => {
        const raw = '```sql\nSELECT * FROM t;\n```';
        expect(stripMarkdownFences(raw)).toBe('SELECT * FROM t;');
    });
});

describe("safeJsonParse", () => {
    it("parses valid JSON from markdown", () => {
        const result = safeJsonParse('```json\n{"x": 1}\n```', { x: 0 });
        expect(result.data).toEqual({ x: 1 });
        expect(result.cleaned).toBe('{"x": 1}');
    });

    it("returns fallback for invalid JSON", () => {
        const result = safeJsonParse("not json", { fallback: true } as any);
        expect(result.data).toEqual({ fallback: true });
        expect(result.cleaned).toBe("not json");
    });

    it("returns fallback for empty string", () => {
        const result = safeJsonParse("", { x: 1 });
        expect(result.data).toEqual({ x: 1 });
        expect(result.cleaned).toBe("");
    });
});

describe("buildSemanticGroups", () => {
    it("groups columns by prefix patterns", () => {
        const cols = ["MntWines", "MntMeat", "NumWebPurchases", "Income", "Year_Birth", "Response_1"];
        const groups = buildSemanticGroups(cols);
        expect(groups["Spending (MNT)"]).toEqual(["MntWines", "MntMeat"]);
        expect(groups["Count/Web"]).toEqual(["NumWebPurchases"]);
        expect(groups["Income"]).toEqual(["Income"]);
        expect(groups["Year"]).toEqual(["Year_Birth"]);
        expect(groups["Response"]).toEqual(["Response_1"]);
    });

    it("groups remaining columns by keyword heuristics", () => {
        const cols = ["category", "order_date", "customer_id"];
        const groups = buildSemanticGroups(cols);
        expect(groups["Categorical"]).toEqual(["category"]);
        expect(groups["Date/Time"]).toEqual(["order_date"]);
        expect(groups["ID"]).toEqual(["customer_id"]);
    });

    it("falls back to Other for unrecognized columns", () => {
        const groups = buildSemanticGroups(["random_col"]);
        expect(groups["Other"]).toEqual(["random_col"]);
    });

    it("returns empty groups for empty input", () => {
        expect(buildSemanticGroups([])).toEqual({});
    });
});

describe("formatSemanticGroups", () => {
    it("formats groups as bullet list", () => {
        const groups = { Spending: ["MntWines"], Income: ["Income"] };
        const result = formatSemanticGroups(groups);
        expect(result).toContain("- Spending: MntWines");
        expect(result).toContain("- Income: Income");
    });

    it("returns fallback for empty groups", () => {
        expect(formatSemanticGroups({})).toBe("No semantic groups detected.");
    });

    it("skips empty group arrays", () => {
        expect(formatSemanticGroups({ Empty: [], Other: ["col"] })).toBe("- Other: col");
    });
});

describe("queryMentionsTable", () => {
    it("returns true when query mentions table name", () => {
        expect(queryMentionsTable("show me sales data", "sales")).toBe(true);
    });

    it("returns false when query does not mention table name", () => {
        expect(queryMentionsTable("show me revenue", "sales")).toBe(false);
    });

    it("is case insensitive", () => {
        expect(queryMentionsTable("Show me SALES", "sales")).toBe(true);
        expect(queryMentionsTable("show me sales", "SALES")).toBe(true);
    });

    it("matches whole words only", () => {
        expect(queryMentionsTable("sales data", "sales")).toBe(true);
        expect(queryMentionsTable("salesperson", "sales")).toBe(false);
        expect(queryMentionsTable("overalls", "sales")).toBe(false);
    });
});

describe("extractCodeBlock", () => {
    it("extracts code block with language", () => {
        const raw = 'Some text\n```python\nprint("hello")\n```\nend';
        expect(extractCodeBlock(raw, "python")).toBe('print("hello")');
    });

    it("extracts first code block without language", () => {
        const raw = 'Prefix\n```\ncode here\n```\nSuffix';
        expect(extractCodeBlock(raw)).toBe("code here");
    });

    it("returns trimmed string if no code block", () => {
        expect(extractCodeBlock("  just text  ")).toBe("just text");
    });

    it("returns empty string for empty input", () => {
        expect(extractCodeBlock("")).toBe("");
    });
});

describe("diceSimilarity", () => {
    it("returns 1 for identical strings", () => {
        expect(diceSimilarity("hello", "hello")).toBe(1);
    });

    it("returns 0 for completely different strings", () => {
        expect(diceSimilarity("abc", "xyz")).toBe(0);
    });

    it("returns intermediate value for similar strings", () => {
        const score = diceSimilarity("income", "incomes");
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(1);
    });

    it("returns 1 for two empty strings", () => {
        expect(diceSimilarity("", "")).toBe(1);
    });

    it("is case insensitive", () => {
        expect(diceSimilarity("Income", "income")).toBe(1);
    });
});

describe("findClosestColumn", () => {
    const columns = ["customer_id", "income", "sales_amount", "order_date"];

    it("returns exact match when found", () => {
        expect(findClosestColumn(columns, "income")).toBe("income");
    });

    it("returns fuzzy match above threshold", () => {
        const result = findClosestColumn(columns, "incme", 0.3);
        expect(result).toBe("income");
    });

    it("returns null when no match exceeds threshold", () => {
        const result = findClosestColumn(columns, "xyz", 0.6);
        expect(result).toBeNull();
    });

    it("returns exact match even with high threshold", () => {
        expect(findClosestColumn(columns, "customer_id", 0.99)).toBe("customer_id");
    });

    it("handles empty columns array", () => {
        expect(findClosestColumn([], "anything")).toBeNull();
    });
});
