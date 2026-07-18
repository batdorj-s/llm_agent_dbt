import { describe, it, expect, vi } from "vitest";

describe("Alerts Service Utility Functions", () => {
  let alertsModule: any;

  beforeAll(async () => {
    alertsModule = await import("../services/alerts.js");
  });

  it("getNumericColumns returns columns matching numeric keywords", () => {
    const { getNumericColumns } = alertsModule;
    const row = { name: "test", amount: 100, revenue: 500, category: "A" };
    const result = getNumericColumns(row);
    expect(result).toContain("amount");
    expect(result).toContain("revenue");
    expect(result).not.toContain("name");
  });

  it("getNumericColumns returns empty when no matches", () => {
    const { getNumericColumns } = alertsModule;
    expect(getNumericColumns({ name: "test" })).toEqual([]);
  });

  it("findColumn finds first match", () => {
    const { findColumn } = alertsModule;
    expect(findColumn(["name", "amount", "total"], [/total/i])).toBe("total");
  });

  it("findColumn returns undefined when no match", () => {
    const { findColumn } = alertsModule;
    expect(findColumn(["name"], [/amount/i])).toBeUndefined();
  });

  it("sumColumn sums numeric column", () => {
    const { sumColumn } = alertsModule;
    expect(sumColumn([{ v: 1 }, { v: 2 }], "v")).toBe(3);
  });

  it("sumColumn returns 0 for undefined col", () => {
    const { sumColumn } = alertsModule;
    expect(sumColumn([{ v: 1 }], undefined)).toBe(0);
  });

  it("buildDefaultRules returns 4 rules with expected ids", () => {
    const { buildDefaultRules } = alertsModule;
    const rules = buildDefaultRules();
    expect(rules).toHaveLength(4);
    const ids = rules.map((r: any) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining(["negative-profit", "zero-values", "high-expense-ratio", "anomaly-zscore"])
    );
  });
});

describe("Alerts Service scanAlerts", () => {
  it("returns empty array when no active catalog entry", async () => {
    vi.resetModules();
    vi.doMock("../db/data-lake.js", () => ({
      getActiveCatalogEntry: vi.fn().mockResolvedValue(null),
      getPool: vi.fn(),
    }));
    const { scanAlerts } = await import("../services/alerts.js");
    expect(await scanAlerts("test-user")).toEqual([]);
  });

  it("returns empty array when pool query throws", async () => {
    vi.resetModules();
    vi.doMock("../db/data-lake.js", () => ({
      getActiveCatalogEntry: vi.fn().mockResolvedValue({
        table_name: "test_table",
        columns_info: JSON.stringify(["amount", "name"]),
      }),
      getPool: vi.fn().mockReturnValue({
        query: vi.fn().mockRejectedValue(new Error("DB error")),
      }),
    }));
    const { scanAlerts } = await import("../services/alerts.js");
    expect(await scanAlerts("test-user")).toEqual([]);
  });
});
