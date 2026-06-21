import { describe, it, expect } from "vitest";
import { buildDeterministicTechSql } from "../agents/sqlGeneration.js";
import { findConceptColumn } from "../agents/columnSynonyms.js";

function makeEntry(tableName: string, columns: string[]) {
    return {
        id: 1,
        table_name: tableName,
        created_by: null,
        owner_id: null,
        visibility: "shared" as const,
        created_at: "2025-01-01",
        columns_info: JSON.stringify(columns),
        description: null,
    };
}

const S_TABLE = makeEntry("s", [
    "invoiceid","branch","city","cust_type","gender","type",
    "unit_price","quantity","date","time","payment","cost","gross_income","rating",
]);

const SUPERSTORE_SALES = makeEntry("superstore_sales", [
    "order_id","order_date","sales","profit","customer_id","segment","category",
]);

const RETAIL_SALES = makeEntry("retail_sales", [
    "transaction_id","date","customer_id","product_category","amount","quantity","payment_method",
]);

describe("buildDeterministicTechSql — column synonym mapping", () => {
    it("BUG-SCENARIO: returns SQL for s table (top 5 products by sales)", async () => {
        const sql = await buildDeterministicTechSql("top 5 products by sales", S_TABLE);

        expect(sql).not.toBeNull();
        expect(sql).toContain("gross_income");
        expect(sql).toContain("type");
    });

    it("FIX-SCENARIO: still returns SQL for superstore_sales (top 5 category by sales)", async () => {
        const sql = await buildDeterministicTechSql("top 5 products by sales", SUPERSTORE_SALES);

        expect(sql).not.toBeNull();
        expect(sql).toContain("sales");
        expect(sql).toContain("category");
    });

    it("FIX-SCENARIO: returns SQL for retail_sales (amount/product_category)", async () => {
        const sql = await buildDeterministicTechSql("top 5 products by sales", RETAIL_SALES);

        expect(sql).not.toBeNull();
        expect(sql).toContain("amount");
        expect(sql).toContain("product_category");
    });

    it("returns SQL for count query on s table", async () => {
        const sql = await buildDeterministicTechSql("хэдэн мөр байна", S_TABLE);

        expect(sql).not.toBeNull();
        expect(sql).toContain("COUNT");
        expect(sql).toContain("s");
    });

    it("returns null for non-matching query", async () => {
        const sql = await buildDeterministicTechSql("what is the weather today", S_TABLE);
        expect(sql).toBeNull();
    });

    it("COLLISION: different columns for different concepts — no ambiguity", () => {
        const cols = ["id", "revenue", "product_name"];
        expect(findConceptColumn(cols, "sales")).toBe("revenue");
        expect(findConceptColumn(cols, "product")).toBe("product_name");
    });

    it("COLLISION: same column matches both sales and product — prefers unambiguous match", () => {
        const cols = ["id", "sales_category", "gross_income", "item_name"];
        const salesCol = findConceptColumn(cols, "sales");
        const productCol = findConceptColumn(cols, "product");

        expect(salesCol).not.toBe(productCol);
        expect(salesCol).toBe("gross_income");
        expect(productCol).toBe("item_name");
    });

    it("COLLISION: only ambiguous column available — returns it as last resort", () => {
        const cols = ["id", "sales_category", "other_field"];
        const salesCol = findConceptColumn(cols, "sales");
        const productCol = findConceptColumn(cols, "product");

        expect(salesCol).toBe("sales_category");
        expect(productCol).toBe("sales_category");
    });
});
