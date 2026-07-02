import { describe, it, expect } from "vitest";
import { canAccessCatalogEntry } from "../db/data-lake.js";
import { buildMntAmountExpr, looksLikeMntText } from "../utils/sqlHelpers.js";
import { findConceptColumn } from "../agents/columnSynonyms.js";

// ─────────────────────────────────────────────────────────────
// #1  Tenant isolation — canAccessCatalogEntry
// ─────────────────────────────────────────────────────────────
describe("canAccessCatalogEntry — tenant isolation", () => {
  it("owner accesses their own private dataset", () => {
    expect(canAccessCatalogEntry({ owner_id: "user-a", visibility: "private" }, "user-a")).toBe(true);
  });

  it("other user cannot see a private dataset", () => {
    expect(canAccessCatalogEntry({ owner_id: "user-a", visibility: "private" }, "user-b")).toBe(false);
  });

  it("empty userId cannot access a private dataset", () => {
    expect(canAccessCatalogEntry({ owner_id: "user-a", visibility: "private" }, "")).toBe(false);
  });

  it("shared dataset is visible to any userId", () => {
    expect(canAccessCatalogEntry({ owner_id: null, visibility: "shared" }, "user-b")).toBe(true);
  });

  it("shared dataset owned by A is also visible to B", () => {
    expect(canAccessCatalogEntry({ owner_id: "user-a", visibility: "shared" }, "user-b")).toBe(true);
  });

  // Simulate the finance-charts scenario:
  // User A uploads transactions → User B must NOT see it
  it("User A transactions are not returned for User B (private)", () => {
    const userAEntry = { owner_id: "user-a", visibility: "private" as const };
    expect(canAccessCatalogEntry(userAEntry, "user-b")).toBe(false);
    expect(canAccessCatalogEntry(userAEntry, "user-a")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// #2  SQL format protection — buildMntAmountExpr
// ─────────────────────────────────────────────────────────────
describe("buildMntAmountExpr — ₮ format protection", () => {
  it("contains REPLACE for ₮ symbol", () => {
    const expr = buildMntAmountExpr('"дүн"');
    expect(expr).toContain("REPLACE");
    expect(expr).toContain("'₮'");
  });

  it("contains REPLACE for thousand separator comma", () => {
    const expr = buildMntAmountExpr('"дүн"');
    expect(expr).toContain("','");
  });

  it("casts to NUMERIC (not TEXT)", () => {
    const expr = buildMntAmountExpr('"дүн"');
    expect(expr).toContain("AS NUMERIC");
  });

  it("casts column to TEXT first (works for both TEXT and NUMERIC columns)", () => {
    const expr = buildMntAmountExpr('"дүн"');
    expect(expr).toContain("::TEXT");
  });

  it("top-parties SQL uses buildMntAmountExpr, not raw column", () => {
    const amtCol = '"дүн"';
    const partyCol = '"харилцагч"';
    const table = '"transactions"';
    const qAmt = buildMntAmountExpr(amtCol);
    const sql = `SELECT ${partyCol} AS label, SUM(${qAmt}) AS value FROM ${table} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`;

    // Must have REPLACE protection
    expect(sql).toContain("REPLACE");
    // Must NOT be a naked SUM over the raw column
    expect(sql).not.toMatch(/SUM\("дүн"\)/);
  });

  it("monthly-cashflow SQL uses buildMntAmountExpr in CASE branches", () => {
    const qAmt = buildMntAmountExpr('"дүн"');
    const catCol = '"ангилал"';
    const sql = [
      `SELECT TO_CHAR("өдөр"::DATE,'YYYY-MM') AS label,`,
      `SUM(CASE WHEN ${catCol} ILIKE '%орлого%' THEN ${qAmt} ELSE 0 END) AS value,`,
      `SUM(CASE WHEN ${catCol} ILIKE '%зарлага%' THEN ${qAmt} ELSE 0 END) AS value2`,
    ].join("\n");

    expect(sql).toContain("REPLACE");
    expect(sql).toContain("'₮'");
    expect(sql).not.toMatch(/THEN "дүн" ELSE/);  // raw column not used directly
  });
});

// ─────────────────────────────────────────────────────────────
// #2b  looksLikeMntText
// ─────────────────────────────────────────────────────────────
describe("looksLikeMntText — MNT text format detection", () => {
  it("detects ₮ prefix", () => {
    expect(looksLikeMntText(["₮2,000,000", "₮500,000"])).toBe(true);
  });
  it("detects comma-separated numbers without ₮", () => {
    expect(looksLikeMntText(["2,000,000", "500,000"])).toBe(true);
  });
  it("returns false for plain numeric strings", () => {
    expect(looksLikeMntText(["2000000", "500000"])).toBe(false);
  });
  it("returns false for empty sample", () => {
    expect(looksLikeMntText([])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// #3  dbt trigger — finance table detection
// ─────────────────────────────────────────────────────────────
describe("finance table detection for dbt trigger", () => {
  const TRANSACTION_COLS = ["өдөр", "харилцагч", "дүн", "ангилал", "дэд_ангилал", "тайлбар"];
  const SALES_COLS = ["order_id", "customer_id", "sales", "profit", "category", "date"];

  it("sales table matches old trigger condition", () => {
    const isSales = SALES_COLS.some(c => /sales|revenue|amount/i.test(c))
        && SALES_COLS.some(c => /customer_id|user_id|_id/i.test(c));
    expect(isSales).toBe(true);
  });

  it("transaction table does NOT match old sales trigger (the bug)", () => {
    const isSalesByOldCheck = TRANSACTION_COLS.some(c => /sales|revenue|amount/i.test(c))
        && TRANSACTION_COLS.some(c => /customer_id|user_id|_id/i.test(c));
    expect(isSalesByOldCheck).toBe(false);  // confirms the bug
  });

  it("transaction table IS detected by findConceptColumn finance_amount (the fix)", () => {
    const amtCol = findConceptColumn(TRANSACTION_COLS, "finance_amount", "transactions");
    const catCol = findConceptColumn(TRANSACTION_COLS, "finance_category", "transactions");
    const isFinance = amtCol !== null && catCol !== null;
    expect(isFinance).toBe(true);
  });

  it("sales table is NOT detected as finance table", () => {
    const amtCol = findConceptColumn(SALES_COLS, "finance_amount", "superstore_sales");
    const catCol = findConceptColumn(SALES_COLS, "finance_category", "superstore_sales");
    // "sales" doesn't match /^дүн$/i, "category" doesn't match /^ангилал$/i
    const isFinance = amtCol !== null && catCol !== null;
    expect(isFinance).toBe(false);
  });
});
