import { describe, it, expect, vi } from "vitest";

type QueryFn = (text: string, params?: unknown[]) => { rows: unknown[] };

function createMockPool(queries: Record<string, { rows: unknown[] }>) {
  const queryFn: QueryFn = (text: string, _params?: unknown[]) => {
    for (const [pattern, result] of Object.entries(queries)) {
      if (text.includes(pattern)) return result;
    }
    return { rows: [] };
  };
  return { query: vi.fn().mockImplementation(queryFn) };
}

describe("computeMetrics — tenant isolation", () => {
  it("scopes data_lake_catalog query by visibility = 'shared' OR owner_id = $1", async () => {
    const mockPool = createMockPool({
      "data_lake_catalog": { rows: [] },
    });

    vi.doMock("../db/data-lake.js", () => ({
      getPool: vi.fn().mockReturnValue(mockPool),
    }));

    const { computeMetrics } = await import("../agents/reportMetrics.js");
    const result = await computeMetrics("user-test-123");

    expect(result).toBeNull();

    const catalogCall = mockPool.query.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes("data_lake_catalog")
    ) as unknown[] | undefined;
    expect(catalogCall).toBeDefined();
    const sql = catalogCall![0] as string;
    const params = catalogCall![1] as unknown[];

    expect(sql).toContain("visibility = 'shared' OR owner_id = $1");
    expect(params).toContain("user-test-123");
  });

  it("returns null when no table is accessible for the given userId", async () => {
    const mockPool = createMockPool({
      "data_lake_catalog": { rows: [] },
    });

    vi.doMock("../db/data-lake.js", () => ({
      getPool: vi.fn().mockReturnValue(mockPool),
    }));

    const { computeMetrics } = await import("../agents/reportMetrics.js");
    const result = await computeMetrics("nonexistent-user");
    expect(result).toBeNull();
  });

  it("uses detectDateColumn sqlCast instead of inline REPLACE logic", async () => {
    const queryFn: QueryFn = (text: string, params?: unknown[]) => {
      if (text.includes("data_lake_catalog")) {
        return { rows: [{ table_name: "sales_table", columns_info: JSON.stringify(["order_date", "amount", "quantity"]) }] };
      }
      if (text.includes("information_schema") && params?.[0] === "sales_table") {
        return { rows: [{ column_name: "order_date", data_type: "text" }] };
      }
      return { rows: [] };
    };
    const mockPool = { query: vi.fn().mockImplementation(queryFn) };
    vi.doMock("../db/data-lake.js", () => ({
      getPool: vi.fn().mockReturnValue(mockPool),
    }));

    const { computeMetrics } = await import("../agents/reportMetrics.js");
    const result = await computeMetrics("date-test-user");

    const growthSqlCalls = mockPool.query.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("periods")
    );

    for (const call of growthSqlCalls) {
      const sql = call[0] as string;
      expect(sql).not.toContain("REPLACE(");
      expect(sql).toContain("CAST(");
    }
  });


});
