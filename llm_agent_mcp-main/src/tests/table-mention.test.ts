import { describe, it, expect } from "vitest";
import { queryMentionsTable } from "../utils.js";

describe("queryMentionsTable — #9 substring fix", () => {
    it("Bug #9 demonstration: 's' inside 'sales' falsely matches with old .includes()", () => {
        const buggyResult = "show me sales data".toLowerCase().includes("s");
        expect(buggyResult).toBe(true); // old code: false positive!
    });

    it("Bug #9 fixed: 's' should NOT match 'sales' with word-boundary", () => {
        const result = queryMentionsTable("show me sales data", "s");
        expect(result).toBe(false);
    });

    it("legitimate table name 'sales' should match in 'SELECT * FROM sales'", () => {
        const result = queryMentionsTable("SELECT * FROM sales", "sales");
        expect(result).toBe(true);
    });

    it("legitimate table name 'orders' should match 'orders' in text", () => {
        const result = queryMentionsTable("how many orders", "orders");
        expect(result).toBe(true);
    });

    it("partial match 'order' should NOT match 'orders' (word boundary)", () => {
        const result = queryMentionsTable("how many orders", "order");
        expect(result).toBe(false);
    });

    it("table name with regex special chars: 'test+table' matches correctly", () => {
        const result = queryMentionsTable("query about test+table", "test+table");
        expect(result).toBe(true);
    });

    it("table name 's' standalone should match", () => {
        const result = queryMentionsTable("FROM s WHERE", "s");
        expect(result).toBe(true);
    });

    it("table name 's' inside word 'sales' should NOT match", () => {
        const result = queryMentionsTable("FROM sales WHERE", "s");
        expect(result).toBe(false);
    });
});
