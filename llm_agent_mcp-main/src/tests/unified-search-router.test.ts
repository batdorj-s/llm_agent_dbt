import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";

vi.mock("../db/pool.js", () => ({
  getPool: vi.fn(),
}));

vi.mock("../middleware/rbac.js", () => ({
  requirePermission: () => (req: any, _res: any, next: any) => {
    req.user = req.user || { userId: "user-admin-001" };
    next();
  },
}));

vi.mock("../routes/shared.js", () => ({
  log: vi.fn(),
}));

import { getPool } from "../db/pool.js";

const mockedGetPool = getPool as ReturnType<typeof vi.fn>;

function findHandler(routerModule: any, method: string, path: string) {
  const layer = routerModule.default.stack.find(
    (l: any) => l.route?.path === path && l.route.methods[method]
  );
  expect(layer).toBeDefined();
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  const res: any = { _status: 200, _json: null };
  res.status = (s: number) => {
    res._status = s;
    return res;
  };
  res.json = (j: unknown) => {
    res._json = j;
    return res;
  };
  return res;
}

describe("unified-search.router", () => {
  let searchHandler: any;
  let pool: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    pool = { query: vi.fn() };
    mockedGetPool.mockReset();
    mockedGetPool.mockReturnValue(pool);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeAll(async () => {
    const routerModule = await import("../routes/unified-search.router.js");
    searchHandler = findHandler(routerModule, "get", "/search");
  });

  it("returns an empty list for an empty query", async () => {
    const res = mockRes();
    await searchHandler({ query: { q: "   " }, user: { userId: "u1" } }, res);
    expect(res._status).toBe(200);
    expect(res._json.data).toEqual([]);
  });

  it("finds catalog tables by name with a perfect score", async () => {
    pool.query.mockImplementation((sql: string) => {
      if (sql.includes("data_lake_catalog")) {
        return Promise.resolve({
          rows: [{ table_name: "sales_raw", description: "Sales raw data", columns_info: null }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = mockRes();
    await searchHandler({ query: { q: "sales_raw" }, user: { userId: "u1" } }, res);
    expect(res._status).toBe(200);
    const cat = res._json.data.find((r: any) => r.type === "catalog");
    expect(cat).toBeDefined();
    expect(cat.matchField).toBe("table_name");
    expect(cat.score).toBe(100);
  });

  it("matches catalog descriptions and respects owner visibility", async () => {
    pool.query.mockImplementation((sql: string, params: string[]) => {
      expect(params[0]).toBe("u1");
      if (sql.includes("data_lake_catalog")) {
        return Promise.resolve({
          rows: [{ table_name: "orders", description: "Order lines with revenue", columns_info: null }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = mockRes();
    await searchHandler({ query: { q: "revenue" }, user: { userId: "u1" } }, res);
    const cat = res._json.data.find((r: any) => r.type === "catalog");
    expect(cat.matchField).toBe("description");
    expect(cat.score).toBe(50);
  });

  it("finds glossary terms from real yaml files", async () => {
    const res = mockRes();
    await searchHandler({ query: { q: "актив" }, user: { userId: "u1" } }, res);
    const hit = res._json.data.find((r: any) => r.type === "glossary");
    expect(hit).toBeDefined();
    expect(hit.matchField).toBe("title");
    expect(hit.score).toBe(90);
    expect(hit.meta.category).toBeDefined();
  });

  it("searches lineage model names from graph_summary.json", async () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((p: any) =>
      String(p).includes("graph_summary.json")
    );
    const readSpy = vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({
        nodes: [
          { name: "stg_sales", description: "staging sales", resource_type: "model" },
          { name: "stg_orders", description: "staging orders", resource_type: "model" },
        ],
      }) as any
    );
    const res = mockRes();
    await searchHandler({ query: { q: "stg_orders" }, user: { userId: "u1" } }, res);
    expect(existsSpy).toHaveBeenCalled();
    expect(readSpy).toHaveBeenCalled();
    const hit = res._json.data.find((r: any) => r.type === "lineage");
    expect(hit).toBeDefined();
    expect(hit.title).toBe("stg_orders");
    expect(hit.meta.modelType).toBe("model");
  });

  it("searches quality tests from manifest.json", async () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) =>
      String(p).includes("manifest.json")
    );
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({
        nodes: {
          t1: {
            resource_type: "test",
            name: "not_null_sales_id",
            description: "",
            column_name: "id",
            depends_on: { nodes: ["model.stg_sales"] },
          },
        },
      }) as any
    );
    const res = mockRes();
    await searchHandler({ query: { q: "not_null_sales_id" }, user: { userId: "u1" } }, res);
    const hit = res._json.data.find((r: any) => r.type === "quality");
    expect(hit).toBeDefined();
    expect(hit.matchField).toBe("test_name");
    expect(hit.score).toBe(85);
    expect(hit.meta.column).toBe("id");
    expect(hit.meta.model).toBe("stg_sales");
  });

  it("searches custom data quality tests from the database", async () => {
    pool.query.mockImplementation((sql: string) => {
      if (sql.includes("data_quality_tests")) {
        return Promise.resolve({
          rows: [{ name: "dup_check", description: "duplicate check", model_name: "stg_orders", test_type: "custom" }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = mockRes();
    await searchHandler({ query: { q: "dup_check" }, user: { userId: "u1" } }, res);
    const hit = res._json.data.find((r: any) => r.type === "quality");
    expect(hit).toBeDefined();
    expect(hit.matchField).toBe("custom_test");
    expect(hit.score).toBe(60);
    expect(hit.meta.model).toBe("stg_orders");
  });

  it("sorts mixed results by score descending", async () => {
    pool.query.mockImplementation((sql: string) => {
      if (sql.includes("data_lake_catalog")) {
        return Promise.resolve({
          rows: [{ table_name: "sales_raw", description: "Sales raw data", columns_info: null }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = mockRes();
    await searchHandler({ query: { q: "sales" }, user: { userId: "u1" } }, res);
    const scores = res._json.data.map((r: any) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(res._json.meta.total).toBeGreaterThanOrEqual(1);
  });

  it("returns 500 with a generic error when search crashes", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      "documents: [{ id: 'x', text: 'hello', keywords: [1] }]"
    );
    const res = mockRes();
    await searchHandler({ query: { q: "hello" }, user: { userId: "u1" } }, res);
    expect(res._status).toBe(500);
    expect(res._json).toEqual({ success: false, error: "Search failed" });
  });
});
