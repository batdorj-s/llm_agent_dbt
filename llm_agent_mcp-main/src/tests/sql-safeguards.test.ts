import { describe, it, expect } from "vitest";

function enforceMaxRows(query: string, maxRows: number): string {
  const trimmed = query.trim();
  if (/^select\b/i.test(trimmed) && !/\blimit\b/i.test(trimmed)) {
    const clean = trimmed.replace(/;+\s*$/, "");
    return `${clean} LIMIT ${maxRows};`;
  }
  return trimmed;
}

describe("enforceMaxRows", () => {
  it("adds LIMIT to simple SELECT without trailing semicolon", () => {
    expect(enforceMaxRows("SELECT * FROM finance_combined", 10000))
      .toBe("SELECT * FROM finance_combined LIMIT 10000;");
  });

  it("adds LIMIT to SELECT with trailing semicolon", () => {
    expect(enforceMaxRows("SELECT name, amount FROM finance_combined;", 5000))
      .toBe("SELECT name, amount FROM finance_combined LIMIT 5000;");
  });

  it("adds LIMIT to SELECT with WHERE clause", () => {
    expect(enforceMaxRows("SELECT * FROM t WHERE category = 'income'", 1000))
      .toBe("SELECT * FROM t WHERE category = 'income' LIMIT 1000;");
  });

  it("preserves existing LIMIT clause", () => {
    const q = "SELECT * FROM finance_combined LIMIT 50";
    expect(enforceMaxRows(q, 10000)).toBe(q);
  });

  it("preserves existing LIMIT with value", () => {
    const q = "SELECT * FROM finance_combined LIMIT 50;";
    expect(enforceMaxRows(q, 10000)).toBe(q);
  });

  it("adds LIMIT before OFFSET clause (OFFSET without LIMIT is a risk)", () => {
    expect(enforceMaxRows("SELECT * FROM finance_combined OFFSET 100", 10000))
      .toBe("SELECT * FROM finance_combined OFFSET 100 LIMIT 10000;");
  });

  it("does not modify non-SELECT queries", () => {
    const q = "WITH cte AS (SELECT * FROM t) SELECT * FROM cte";
    expect(enforceMaxRows(q, 10000)).toBe(q);
  });

  it("handles empty query gracefully", () => {
    expect(enforceMaxRows("", 10000)).toBe("");
  });
});
