import { describe, it, expect } from "vitest";
import {
    buildFallbackQuery,
    computeResultStats,
    formatDeterministicTechResponse,
    findColumn,
    isRateLimitError,
} from "../agents/sqlGeneration.js";

describe("buildFallbackQuery", () => {
    const entry = {
        table_name: "test_sales",
        columns_info: JSON.stringify(["gross_income", "sales_amount", "order_date", "customer_id", "category"]),
    };

    it("returns null when entry is null", () => {
        expect(buildFallbackQuery("anything", null)).toBeNull();
    });

    it("returns null when entry has no columns_info", () => {
        expect(buildFallbackQuery("anything", { table_name: "t" })).toBeNull();
    });

    it("returns null for empty columns", () => {
        expect(buildFallbackQuery("anything", { table_name: "t", columns_info: "[]" })).toBeNull();
    });

    it("generates outlier query for outlier-related query", () => {
        const sql = buildFallbackQuery("outlier detection", entry);
        expect(sql).toContain("SELECT");
        expect(sql).toContain("outlier_value");
        expect(sql).toContain("STDDEV");
        expect(sql).toContain("test_sales");
    });

    it("generates income query for income-related query", () => {
        const sql = buildFallbackQuery("нийт борлуулалт", entry);
        expect(sql).toContain("AVG");
        expect(sql).toContain("gross_income");
    });

    it("generates date+numeric fallback when date and numeric columns exist", () => {
        const sql = buildFallbackQuery("show trends", entry);
        expect(sql).toContain("ORDER BY label DESC");
        expect(sql).toContain("SUM");
    });

    it("generates numeric fallback when only numeric column exists", () => {
        const entry2 = {
            table_name: "t",
            columns_info: JSON.stringify(["amount", "other"]),
        };
        const sql = buildFallbackQuery("show data", entry2);
        expect(sql).toContain("ORDER BY");
        expect(sql).not.toContain("GROUP BY");
    });

    it("generates sample query when no matching columns found", () => {
        const entry2 = {
            table_name: "t",
            columns_info: JSON.stringify(["a", "b", "c"]),
        };
        const sql = buildFallbackQuery("show data", entry2);
        expect(sql).toContain('"a"');
        expect(sql).toContain("LIMIT 10");
    });

    it("uses Mongolian outlier keywords", () => {
        const sql = buildFallbackQuery("гажуудал илрүүлэх", entry);
        expect(sql).toContain("outlier_value");
    });
});

describe("findColumn", () => {
    const columns = ["sales_amount", "customer_id", "order_date"];

    it("finds column matching a pattern", () => {
        expect(findColumn(columns, [/sales/i])).toBe("sales_amount");
    });

    it("returns first match from multiple patterns", () => {
        expect(findColumn(columns, [/date/i, /customer/i])).toBe("order_date");
    });

    it("returns null when no pattern matches", () => {
        expect(findColumn(columns, [/income/i])).toBeNull();
    });

    it("returns null for empty columns array", () => {
        expect(findColumn([], [/anything/i])).toBeNull();
    });
});

describe("isRateLimitError", () => {
    it("detects rate limit error message", () => {
        expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
    });

    it("detects 429 status code", () => {
        expect(isRateLimitError(new Error("429 Too Many Requests"))).toBe(true);
    });

    it("detects quota exceeded", () => {
        expect(isRateLimitError(new Error("quota exceeded"))).toBe(true);
    });

    it("detects TPD limit", () => {
        expect(isRateLimitError(new Error("tokens per day limit"))).toBe(true);
    });

    it("returns false for unrelated errors", () => {
        expect(isRateLimitError(new Error("timeout"))).toBe(false);
    });

    it("handles string errors", () => {
        expect(isRateLimitError("rate limit hit")).toBe(true);
        expect(isRateLimitError("network error")).toBe(false);
    });
});

describe("formatDeterministicTechResponse", () => {
    it("formats top-N results with numbered list", () => {
        const sql = "SELECT item_name, total_revenue FROM ...";
        const results = [
            { item_name: "Item A", total_revenue: 1000 },
            { item_name: "Item B", total_revenue: 500 },
        ];
        const output = formatDeterministicTechResponse("top 3 products", sql, results);
        expect(output).toContain("Үр дүн");
        expect(output).toContain("1. Item A");
        expect(output).toContain("2. Item B");
        expect(output).toContain("USD");
    });

    it("formats count result with Mongolian text", () => {
        const results = [{ total_rows: 150 }];
        const output = formatDeterministicTechResponse("нийт хэдэн мөр", "SELECT COUNT(*)", results);
        expect(output).toContain("Нийт мөрийн тоо");
        expect(output).toContain("150");
    });

    it("formats average result with total and avg", () => {
        const results = [{ total_rows: 100, average_value: 50 }];
        const output = formatDeterministicTechResponse("нийт хэдэн average value", "SELECT ...", results);
        expect(output).toContain("Дундаж утга");
        expect(output).toContain("50");
    });

    it("falls back to JSON display for unknown query types", () => {
        const results = [{ x: 1, y: 2 }];
        const output = formatDeterministicTechResponse("custom query", "SELECT ...", results);
        expect(output).toContain("```json");
        expect(output).toContain('"x": 1');
    });
});

describe("computeResultStats", () => {
    it("returns empty string for empty array", () => {
        expect(computeResultStats("[]")).toBe("");
    });

    it("returns empty string for invalid JSON", () => {
        expect(computeResultStats("not json")).toBe("");
    });

    it("returns empty string for non-array JSON", () => {
        expect(computeResultStats('{"key": "val"}')).toBe("");
    });

    it("computes stats for numeric columns", () => {
        const data = JSON.stringify([
            { sales: 100, name: "A" },
            { sales: 200, name: "B" },
            { sales: 300, name: "C" },
        ]);
        const result = computeResultStats(data);
        expect(result).toContain("Data Statistics");
        expect(result).toContain("sales");
        expect(result).toContain("avg=");
        expect(result).toContain("median=");
        expect(result).toContain("200.0");
    });

    it("returns empty string when no numeric columns found", () => {
        const data = JSON.stringify([
            { name: "A" },
            { name: "B" },
        ]);
        expect(computeResultStats(data)).toBe("");
    });

    it("detects outliers in data", () => {
        const data = JSON.stringify([
            { val: 10 }, { val: 20 }, { val: 30 }, { val: 40 }, { val: 50 }, { val: 999 },
        ]);
        const result = computeResultStats(data);
        expect(result).toContain("Outliers");
    });
});
