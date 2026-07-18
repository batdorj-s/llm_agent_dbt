import { describe, it, expect, vi, beforeAll } from "vitest";

describe("Dashboard Builder Agent", () => {
  let buildDashboard: any;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock("../llm-provider.js", () => ({
      invokeWithFallback: vi.fn().mockResolvedValue({
        content: JSON.stringify([{ id: "c1", type: "kpi", sql: "SELECT count(*) FROM test", label: "Total" }]),
      }),
    }));
    vi.doMock("../db/data-lake.js", () => ({
      getCatalog: vi.fn().mockResolvedValue([
        { table_name: "test_table", columns_info: JSON.stringify(["revenue", "cost"]), id: "t1" },
      ]),
      getActiveCatalogEntry: vi.fn().mockResolvedValue({
        table_name: "test_table", columns_info: JSON.stringify(["revenue", "cost"]), id: "t1",
      }),
      buildSchemaDefinition: vi.fn().mockResolvedValue("column1, column2"),
    }));
    vi.doMock("../tools/enterprise-tools.js", () => ({
      handleExecuteSql: vi.fn().mockResolvedValue({ ok: true, results: [{ value: 100 }] }),
    }));
    vi.doMock("../utils.js", () => ({
      safeJsonParse: vi.fn((s: string) => { try { return { data: JSON.parse(s), error: null }; } catch { return { error: "parse error" }; } }),
      buildSemanticGroups: vi.fn().mockReturnValue([]),
      formatSemanticGroups: vi.fn().mockReturnValue(""),
      queryMentionsTable: vi.fn().mockReturnValue(true),
      extractCodeBlock: vi.fn().mockReturnValue("print('hello')"),
    }));

    const mod = await import("../agents/dashboardBuilder.js");
    buildDashboard = mod.buildDashboard;
  });

  it("returns dashboard JSON on success", async () => {
    const result = await buildDashboard({}, "show dashboard", "user-1");
    expect(result.messages).toBeDefined();
    expect(result.messages[0].content).toContain("<dashboard>");
    expect(result.messages[0].content).toContain("Total");
  });

  it("returns fallback when no active catalog entry", async () => {
    vi.resetModules();
    vi.doMock("../llm-provider.js", () => ({ invokeWithFallback: vi.fn() }));
    vi.doMock("../db/data-lake.js", () => ({
      getCatalog: vi.fn().mockResolvedValue([]),
      getActiveCatalogEntry: vi.fn().mockResolvedValue(null),
      buildSchemaDefinition: vi.fn(),
    }));
    vi.doMock("../utils.js", () => ({
      safeJsonParse: vi.fn(),
      buildSemanticGroups: vi.fn().mockReturnValue([]),
      formatSemanticGroups: vi.fn().mockReturnValue(""),
      queryMentionsTable: vi.fn().mockReturnValue(false),
    }));
    const { buildDashboard: bd } = await import("../agents/dashboardBuilder.js");
    const result = await bd({}, "show dashboard", "user-1");
    expect(result.messages[0].content).toContain("Идэвхтэй хүснэгт олдсонгүй");
  });

  it("handles LLM failure gracefully", async () => {
    vi.resetModules();
    vi.doMock("../llm-provider.js", () => ({
      invokeWithFallback: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    }));
    vi.doMock("../db/data-lake.js", () => ({
      getCatalog: vi.fn().mockResolvedValue([]),
      getActiveCatalogEntry: vi.fn().mockResolvedValue({
        table_name: "test", columns_info: "[]", id: "t1",
      }),
      buildSchemaDefinition: vi.fn().mockResolvedValue("cols"),
    }));
    vi.doMock("../utils.js", () => ({
      safeJsonParse: vi.fn(),
      buildSemanticGroups: vi.fn().mockReturnValue([]),
      formatSemanticGroups: vi.fn().mockReturnValue(""),
      queryMentionsTable: vi.fn().mockReturnValue(true),
    }));
    const { buildDashboard: bd } = await import("../agents/dashboardBuilder.js");
    const result = await bd({}, "show dashboard", "user-1");
    expect(result.messages[0].content).toContain("алдаа");
  });
});
