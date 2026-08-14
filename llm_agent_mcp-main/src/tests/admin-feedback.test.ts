import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type * as NodeFs from "node:fs";
import path from "path";
import { vol } from "memfs";

vi.mock("node:fs");
vi.mock("node:fs/promises");

vi.mock("../db/pool.js", () => ({
  getPool: vi.fn(),
}));

vi.mock("../db/data-lake.js", () => ({
  getPool: vi.fn(),
}));

vi.mock("../rag.js", () => ({
  removeDocumentsByPrefix: vi.fn(async () => 0),
  addDocumentToCatalog: vi.fn(async () => undefined),
}));

import { getPool } from "../db/pool.js";

const mockedPool = { query: vi.fn() };
(getPool as ReturnType<typeof vi.fn>).mockReturnValue(mockedPool);

function fbRow(id: string, status: string, response = "bad answer") {
  return {
    id,
    user_id: "u1",
    message: `${id} query`,
    response,
    rating: "negative",
    status,
    thread_id: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
  };
}

function findHandler(router: any, method: string, routePath: string) {
  const layer = router.default.stack.find(
    (l: any) => l.route?.path === routePath && l.route.methods[method]
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

describe("Admin Router — Feedback routes", () => {
  let router: any;

  beforeAll(async () => {
    const realFs = await vi.importActual<typeof NodeFs>("node:fs");
    vol.fromJSON({
      "src/prompts.yaml": realFs.readFileSync(path.resolve("src/prompts.yaml"), "utf8"),
      "./src/prompts.yaml": realFs.readFileSync(path.resolve("src/prompts.yaml"), "utf8"),
    });
    router = await import("../routes/admin.router.js");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockedPool.query.mockReset();
  });

  it("registers pending / approve / reject / batch routes", () => {
    expect(router.default.stack.find((l: any) => l.route?.path === "/feedback/pending" && l.route.methods.get)).toBeDefined();
    expect(router.default.stack.find((l: any) => l.route?.path === "/feedback/:id/approve" && l.route.methods.post)).toBeDefined();
    expect(router.default.stack.find((l: any) => l.route?.path === "/feedback/:id/reject" && l.route.methods.post)).toBeDefined();
    expect(router.default.stack.find((l: any) => l.route?.path === "/feedback/batch" && l.route.methods.post)).toBeDefined();
  });

  it("GET /feedback/pending returns only pending entries", async () => {
    mockedPool.query.mockResolvedValue({ rows: [fbRow("fb_1", "pending"), fbRow("fb_2", "pending")] });
    const handle = findHandler(router, "get", "/feedback/pending");
    const res = mockRes();
    await handle({}, res);
    expect(mockedPool.query.mock.calls[0][0]).toContain("WHERE status = $1");
    expect(mockedPool.query.mock.calls[0][1]).toEqual(["pending"]);
    expect(res._json.map((f: any) => f.id).sort()).toEqual(["fb_1", "fb_2"]);
  });

  it("POST /feedback/:id/approve marks approved and adds to RAG", async () => {
    const { addDocumentToCatalog } = await import("../rag.js");
    mockedPool.query
      .mockResolvedValueOnce({ rows: [fbRow("fb_1", "pending")] })
      .mockResolvedValueOnce({ rows: [{ id: "fb_1" }] });
    const handle = findHandler(router, "post", "/feedback/:id/approve");
    const res = mockRes();
    await handle({ params: { id: "fb_1" }, body: { correctAnswer: "SELECT 1" } }, res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    const updateCall = mockedPool.query.mock.calls[1];
    expect(updateCall[0]).toContain("UPDATE feedback");
    expect(updateCall[1]).toEqual(["approved", "fb_1"]);
    expect(addDocumentToCatalog).toHaveBeenCalledTimes(1);
    expect(addDocumentToCatalog).toHaveBeenCalledWith("fb_1", expect.stringContaining("SELECT 1"), expect.anything(), expect.anything());
  });

  it("POST /feedback/:id/approve returns 404 for unknown id", async () => {
    mockedPool.query.mockResolvedValue({ rows: [] });
    const handle = findHandler(router, "post", "/feedback/:id/approve");
    const res = mockRes();
    await handle({ params: { id: "missing" }, body: {} }, res);
    expect(res._status).toBe(404);
  });

  it("POST /feedback/:id/approve does not re-add already approved entries", async () => {
    const { addDocumentToCatalog } = await import("../rag.js");
    mockedPool.query.mockResolvedValue({ rows: [fbRow("fb_3", "approved")] });
    const handle = findHandler(router, "post", "/feedback/:id/approve");
    const res = mockRes();
    await handle({ params: { id: "fb_3" }, body: {} }, res);
    expect(res._json.message).toMatch(/already approved/i);
    expect(addDocumentToCatalog).not.toHaveBeenCalled();
  });

  it("POST /feedback/:id/reject marks rejected", async () => {
    mockedPool.query
      .mockResolvedValueOnce({ rows: [fbRow("fb_2", "pending")] })
      .mockResolvedValueOnce({ rows: [{ id: "fb_2" }] });
    const handle = findHandler(router, "post", "/feedback/:id/reject");
    const res = mockRes();
    await handle({ params: { id: "fb_2" }, body: {} }, res);
    expect(res._json.success).toBe(true);
    const updateCall = mockedPool.query.mock.calls[1];
    expect(updateCall[0]).toContain("UPDATE feedback");
    expect(updateCall[1]).toEqual(["rejected", "fb_2"]);
  });

  it("POST /feedback/batch approves/rejects in one write", async () => {
    const { addDocumentToCatalog } = await import("../rag.js");
    mockedPool.query
      .mockResolvedValueOnce({ rows: [fbRow("fb_1", "pending")] })
      .mockResolvedValueOnce({ rows: [{ id: "fb_1" }] })
      .mockResolvedValueOnce({ rows: [fbRow("fb_2", "pending", "")] })
      .mockResolvedValueOnce({ rows: [{ id: "fb_2" }] })
      .mockResolvedValueOnce({ rows: [fbRow("fb_3", "approved")] })
      .mockResolvedValueOnce({ rows: [] });
    const handle = findHandler(router, "post", "/feedback/batch");
    const res = mockRes();
    await handle({ body: { ids: ["fb_1", "fb_2", "fb_3", "nope"], action: "approve" } }, res);
    expect(res._json).toMatchObject({ success: true, processed: 2 });
    expect(res._json.skipped.sort()).toEqual(["fb_3", "nope"]);
    const updates = mockedPool.query.mock.calls.filter((c: any) => String(c[0]).includes("UPDATE feedback"));
    expect(updates).toHaveLength(2);
    expect(updates[0][1]).toEqual(["approved", "fb_1"]);
    expect(updates[1][1]).toEqual(["approved", "fb_2"]);
    expect(addDocumentToCatalog).toHaveBeenCalledTimes(1);
  });

  it("POST /feedback/batch rejects invalid action", async () => {
    const handle = findHandler(router, "post", "/feedback/batch");
    const res = mockRes();
    await handle({ body: { ids: ["fb_1"], action: "delete" } }, res);
    expect(res._status).toBe(400);
  });

  it("POST /feedback/batch rejects empty ids", async () => {
    const handle = findHandler(router, "post", "/feedback/batch");
    const res = mockRes();
    await handle({ body: { ids: [], action: "approve" } }, res);
    expect(res._status).toBe(400);
  });
});