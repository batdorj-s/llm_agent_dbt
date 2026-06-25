import { describe, it, expect } from "vitest";
import { buildDeterministicTechSql, buildFallbackQuery } from "../agents/sqlGeneration.js";
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

const SYNTHETIC_INCOME = makeEntry("synthetic_income", [
    "id", "gross_income_mnt", "other_col",
]);

describe("buildFallbackQuery — #4 hardcoded incomeCol fix", () => {
    it("BUG-SCENARIO: old code hardcodes 'gross_income' when actual column is 'gross_income_mnt'", () => {
        const sql = buildFallbackQuery("show me gross income", SYNTHETIC_INCOME);
        expect(sql).not.toBeNull();

        // Old code would produce: WHERE "gross_income" > ... (hits PG error)
        // New code should use actual column name
        expect(sql).toContain("gross_income_mnt");
        expect(sql).not.toContain('"gross_income"'); // not the bare hardcoded name
    });

    it("FIX-SCENARIO: standard 'gross_income' column still works", () => {
        const sql = buildFallbackQuery("gross income analysis", S_TABLE);
        expect(sql).not.toBeNull();
        expect(sql).toContain("gross_income");
    });

    it("FIX-SCENARIO: 'income' column also matched as fallback", () => {
        const entry = makeEntry("test_table", ["id", "net_income", "name"]);
        const sql = buildFallbackQuery("show income", entry);
        expect(sql).not.toBeNull();
        expect(sql).toContain("net_income");
    });

    it("FIX-SCENARIO: no income column → no income-specific SQL, generic fallback instead", () => {
        const entry = makeEntry("test_table", ["id", "name"]);
        const sql = buildFallbackQuery("show income", entry);
        expect(sql).not.toBeNull();
        expect(sql).not.toContain("income"); // no income-specific aggregation
        expect(sql).toContain("LIMIT 10");   // generic fallback
    });
});

describe("buildDeterministicTechSql — column synonym mapping", () => {
    it("FIX-SCENARIO: s table has no 'sales' column (gross_income is 'income'), top-5 query returns null → falls to LLM", async () => {
        const sql = await buildDeterministicTechSql("top 5 products by sales", S_TABLE);

        // gross_income is now an 'income' column, not 'sales' — so deterministic path returns null
        // Agent will fall back to LLM-generated SQL, which can handle the column mapping
        expect(sql).toBeNull();
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

    it("COLLISION: sales and income are now separate concepts — gross_income matches income, not sales", () => {
        const cols = ["id", "sales_category", "gross_income", "item_name"];
        const salesCol = findConceptColumn(cols, "sales");
        const productCol = findConceptColumn(cols, "product");
        const incomeCol = findConceptColumn(cols, "income");

        // gross_income now belongs to "income" concept, not "sales"
        expect(incomeCol).toBe("gross_income");
        expect(salesCol).not.toBe("gross_income");
        expect(salesCol).not.toBe(productCol);
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
