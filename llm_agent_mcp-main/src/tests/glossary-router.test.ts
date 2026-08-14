import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("../middleware/rbac.js", () => ({
  requirePermission: (_perm: string) => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../routes/shared.js", () => ({
  log: vi.fn(),
}));

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

describe("glossary.router", () => {
  let glossaryRouter: any;
  let handle: any;

  beforeAll(async () => {
    glossaryRouter = await import("../routes/glossary.router.js");
    handle = findHandler(glossaryRouter, "get", "/glossary");
  });

  it("returns all glossary entries with category/department facets", async () => {
    const res = mockRes();
    await handle({ query: {} }, res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(res._json.meta.total).toBe(res._json.data.length);
    expect(Array.isArray(res._json.meta.categories)).toBe(true);
    expect(Array.isArray(res._json.meta.departments)).toBe(true);
    for (const entry of res._json.data) {
      expect(entry).toHaveProperty("term");
      expect(entry).toHaveProperty("definition");
      expect(entry).toHaveProperty("category");
      expect(entry).toHaveProperty("source");
    }
  });

  it("filters by search term case-insensitively", async () => {
    const res = mockRes();
    await handle({ query: { search: "income" } }, res);
    expect(res._status).toBe(200);
    for (const entry of res._json.data) {
      const haystack = [
        entry.term,
        entry.definition,
        ...(entry.keywords || []),
        ...(entry.synonyms || []),
      ].join(" ").toLowerCase();
      expect(haystack).toContain("income");
    }
  });

  it("filters by exact category", async () => {
    const res = mockRes();
    await handle({ query: { category: "metric" } }, res);
    expect(res._status).toBe(200);
    if (res._json.data.length > 0) {
      for (const entry of res._json.data) {
        expect(entry.category).toBe("metric");
      }
    }
  });

  it("filters by department", async () => {
    const res = mockRes();
    await handle({ query: { department: "finance" } }, res);
    expect(res._status).toBe(200);
    for (const entry of res._json.data) {
      expect(entry.department).toBe("finance");
    }
  });

  it("handles unknown search with an empty result set", async () => {
    const res = mockRes();
    await handle({ query: { search: "zzz-non-existent-term-xyz" } }, res);
    expect(res._status).toBe(200);
    expect(res._json.data).toEqual([]);
  });
});