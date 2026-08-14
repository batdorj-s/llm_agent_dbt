import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
  },
}));

vi.mock("../middleware/rbac.js", () => ({
  requirePermission: (_perm: string) => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../routes/shared.js", () => ({
  log: vi.fn(),
}));

import fs from "fs";

const mockedExists = (fs as any).existsSync as ReturnType<typeof vi.fn>;
const mockedRead = (fs as any).readFileSync as ReturnType<typeof vi.fn>;

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

const graphSummary = {
  linked: {
    "0": { name: "source.stg_sales", type: "source", succ: [1] },
    "1": { name: "model.stg_sales", type: "model", succ: [2] },
    "2": { name: "model.int_metrics", type: "model", succ: [] },
  },
};

const manifest = {
  nodes: {
    "model.stg_sales": {
      resource_type: "model",
      description: "Staged sales data with lots of padding to test the 200 char limit truncation behavior",
      config: { materialized: "view" },
    },
  },
};

describe("lineage.router", () => {
  let lineageRouter: any;
  let handle: any;

  beforeAll(async () => {
    lineageRouter = await import("../routes/lineage.router.js");
    handle = findHandler(lineageRouter, "get", "/lineage");
  });

  beforeEach(() => {
    mockedExists.mockReset();
    mockedRead.mockReset();
  });

  it("returns available:false when the dbt graph is missing", async () => {
    mockedExists.mockReturnValue(false);
    const res = mockRes();
    await handle({ query: {} }, res);
    expect(res._status).toBe(200);
    expect(res._json.data.available).toBe(false);
  });

  it("returns nodes and edges from graph_summary.json", async () => {
    mockedExists.mockImplementation((p: string) =>
      p.includes("graph_summary.json") || p.includes("manifest.json")
    );
    mockedRead.mockImplementation((p: string) => {
      if (p.includes("graph_summary.json")) return JSON.stringify(graphSummary);
      return JSON.stringify(manifest);
    });
    const res = mockRes();
    await handle({ query: {} }, res);
    expect(res._status).toBe(200);
    expect(res._json.data.nodes).toHaveLength(3);
    expect(res._json.data.edges).toHaveLength(2);
    const salesNode = res._json.data.nodes.find((n: any) => n.shortName === "stg_sales");
    expect(salesNode.meta.materialized).toBe("view");
    expect(salesNode.meta.description.length).toBeLessThanOrEqual(200);
  });

  it("filters nodes by type", async () => {
    mockedExists.mockImplementation((p: string) => p.includes("graph_summary.json"));
    mockedRead.mockImplementation((p: string) => {
      if (p.includes("graph_summary.json")) return JSON.stringify(graphSummary);
      return "{}";
    });
    const res = mockRes();
    await handle({ query: { type: "model" } }, res);
    expect(res._status).toBe(200);
    expect(res._json.data.nodes.every((n: any) => n.type === "model")).toBe(true);
  });

  it("returns the subgraph for a specific model", async () => {
    mockedExists.mockImplementation((p: string) => p.includes("graph_summary.json"));
    mockedRead.mockImplementation((p: string) => {
      if (p.includes("graph_summary.json")) return JSON.stringify(graphSummary);
      return "{}";
    });
    const res = mockRes();
    await handle({ query: { model: "int_metrics" } }, res);
    expect(res._status).toBe(200);
    const names = res._json.data.nodes.map((n: any) => n.shortName);
    expect(names).toContain("int_metrics");
    expect(names).toContain("stg_sales");
    expect(names).toContain("source.stg_sales".split(".").pop());
  });
});