import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/data-lake.js", () => ({
  getActiveCatalogEntry: vi.fn(),
  getPool: vi.fn(),
}));

import { getActiveCatalogEntry, getPool } from "../db/data-lake.js";

const mockedGetEntry = getActiveCatalogEntry as ReturnType<typeof vi.fn>;
const mockedPool = { query: vi.fn() };
(getPool as ReturnType<typeof vi.fn>).mockReturnValue(mockedPool);

describe("alerts — column helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    mockedGetEntry.mockReset();
    mockedPool.query.mockReset();
  });

  it("getNumericColumns filters numeric-keyword columns", async () => {
    const { getNumericColumns } = await import("../services/alerts.js");
    const cols = getNumericColumns({ amount: 1, name: "x", revenue_total: 2, id: 3 });
    expect(cols).toContain("amount");
    expect(cols).toContain("revenue_total");
    expect(cols).not.toContain("name");
  });

  it("getNumericColumns returns empty when no columns match", async () => {
    const { getNumericColumns } = await import("../services/alerts.js");
    expect(getNumericColumns({ name: "x", id: 3 })).toEqual([]);
  });

  it("findColumn matches keywords case-insensitively", async () => {
    const { findColumn } = await import("../services/alerts.js");
    expect(findColumn(["Revenue", "Name"], [/revenue/i])).toBe("Revenue");
    expect(findColumn(["Name"], [/revenue/i])).toBeUndefined();
  });

  it("sumColumn sums numbers and ignores non-numeric values", async () => {
    const { sumColumn } = await import("../services/alerts.js");
    expect(sumColumn([{ v: 10 }, { v: "5" }, { v: null }, { v: 2 }], "v")).toBe(12);
    expect(sumColumn([{ v: 10 }], undefined)).toBe(0);
  });
});

describe("alerts — rule conditions", () => {
  let buildDefaultRules: any;

  beforeEach(async () => {
    buildDefaultRules = (await import("../services/alerts.js")).buildDefaultRules;
  });

  it("builds 4 rules with expected ids", async () => {
    const rules = buildDefaultRules();
    expect(rules.map((r: any) => r.id)).toEqual([
      "negative-profit",
      "zero-values",
      "high-expense-ratio",
      "anomaly-zscore",
    ]);
  });

  it("fires negative-profit rule when profit column total is negative", () => {
    const rules = buildDefaultRules();
    const rule = rules.find((r: any) => r.id === "negative-profit");
    const alert = rule.condition([{ profit: -100, revenue: 50 }], ["profit", "revenue"]);
    expect(alert).not.toBeNull();
    expect(alert.id).toMatch(/negative-profit/);
    expect(alert.type).toBe("critical");
  });

  it("does not fire negative-profit when profit is positive", () => {
    const rules = buildDefaultRules();
    const rule = rules.find((r: any) => r.id === "negative-profit");
    expect(rule.condition([{ profit: 100 }], ["profit"])).toBeNull();
  });

  it("fires zero-values rule when more than 30% of rows are zero", () => {
    const rules = buildDefaultRules();
    const rule = rules.find((r: any) => r.id === "zero-values");
    const data = [
      { amount: 0 }, { amount: 0 }, { amount: 0 },
      { amount: 10 }, { amount: 20 },
    ];
    const alert = rule.condition(data, ["amount"]);
    expect(alert).not.toBeNull();
    expect(alert.type).toBe("critical");
  });

  it("does not fire zero-values rule when ratio is low", () => {
    const rules = buildDefaultRules();
    const rule = rules.find((r: any) => r.id === "zero-values");
    expect(rule.condition([{ amount: 10 }, { amount: 20 }], ["amount"])).toBeNull();
  });

  it("fires high-expense rule when expenses exceed 80% of revenue", () => {
    const rules = buildDefaultRules();
    const rule = rules.find((r: any) => r.id === "high-expense-ratio");
    const alert = rule.condition(
      [{ revenue: 100, expense: 90 }],
      ["revenue", "expense"]
    );
    expect(alert).not.toBeNull();
    expect(alert.type).toBe("warning");
  });

  it("skips high-expense rule when revenue is zero", () => {
    const rules = buildDefaultRules();
    const rule = rules.find((r: any) => r.id === "high-expense-ratio");
    expect(rule.condition([{ revenue: 0, expense: 90 }], ["revenue", "expense"])).toBeNull();
  });

  it("fires anomaly rule on z-score outliers with 10+ rows", () => {
    const rules = buildDefaultRules();
    const rule = rules.find((r: any) => r.id === "anomaly-zscore");
    const data = [
      { amount: 10 }, { amount: 11 }, { amount: 9 }, { amount: 10 },
      { amount: 10 }, { amount: 11 }, { amount: 9 }, { amount: 10 },
      { amount: 10 }, { amount: 11 }, { amount: 9 }, { amount: 1000 },
    ];
    const alert = rule.condition(data, ["amount"]);
    expect(alert).not.toBeNull();
    expect(alert.type).toBe("info");
  });

  it("skips anomaly rule for fewer than 10 rows", () => {
    const rules = buildDefaultRules();
    const rule = rules.find((r: any) => r.id === "anomaly-zscore");
    expect(rule.condition([{ v: 1 }, { v: 2 }], ["v"])).toBeNull();
  });
});

describe("alerts — scanAlerts", () => {
  beforeEach(() => {
    vi.resetModules();
    mockedGetEntry.mockReset();
    mockedPool.query.mockReset();
  });

  it("returns empty list when the user has no active catalog entry", async () => {
    mockedGetEntry.mockResolvedValueOnce(null);
    const { scanAlerts } = await import("../services/alerts.js");
    expect(await scanAlerts("nobody")).toEqual([]);
  });

  it("scans the active table and returns matching alerts", async () => {
    mockedGetEntry.mockResolvedValueOnce({
      table_name: "sales_table",
      columns_info: JSON.stringify(["profit", "revenue", "expense"]),
    });
    mockedPool.query.mockResolvedValueOnce({
      rows: [
        { profit: -50, revenue: 100, expense: 30 },
        { profit: -10, revenue: 100, expense: 30 },
      ],
    });
    const { scanAlerts } = await import("../services/alerts.js");
    const alerts = await scanAlerts("user-1");
    expect(alerts.some(a => a.id.startsWith("negative-profit"))).toBe(true);

    const sql = mockedPool.query.mock.calls[0][0];
    expect(sql).toContain("sales_table");
  });

  it("returns empty array when the pool query throws", async () => {
    mockedGetEntry.mockResolvedValueOnce({
      table_name: "sales_table",
      columns_info: JSON.stringify(["profit"]),
    });
    mockedPool.query.mockRejectedValueOnce(new Error("db down"));
    const { scanAlerts } = await import("../services/alerts.js");
    expect(await scanAlerts("user-1")).toEqual([]);
  });
});