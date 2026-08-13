import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import path from "path";
import { vol } from "memfs";

vi.mock("node:fs");
vi.mock("node:fs/promises");

vi.mock("../rag.js", () => ({
  removeDocumentsByPrefix: vi.fn(async () => 0),
  addDocumentToCatalog: vi.fn(async () => undefined),
}));

const FIXTURE_PATH = path.resolve(process.cwd(), "data", "failed-queries.json");

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

function fixture() {
  return JSON.stringify([
    { id: "fb_1", userId: "u1", message: "first query", response: "bad answer", rating: "negative", status: "pending", timestamp: "2026-01-01T00:00:00Z" },
    { id: "fb_2", userId: "u1", message: "second query", response: "", rating: "negative", status: "pending", timestamp: "2026-01-01T00:00:00Z" },
    { id: "fb_3", userId: "u1", message: "old query", response: "old answer", rating: "negative", status: "approved", timestamp: "2026-01-01T00:00:00Z" },
  ]);
}

function storedEntries(): any[] {
  return JSON.parse(vol.readFileSync(FIXTURE_PATH, "utf8") as string) as any[];
}

describe("Admin Router — Feedback routes", () => {
  let router: any;

  beforeAll(async () => {
    const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    vol.fromJSON({
      "src/prompts.yaml": realFs.readFileSync(path.resolve("src/prompts.yaml"), "utf8"),
      "./src/prompts.yaml": realFs.readFileSync(path.resolve("src/prompts.yaml"), "utf8"),
    });
    router = await import("../routes/admin.router.js");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
    vol.fromJSON({ [FIXTURE_PATH]: fixture() });
  });

  it("registers pending / approve / reject / batch routes", () => {
    expect(router.default.stack.find((l: any) => l.route?.path === "/feedback/pending" && l.route.methods.get)).toBeDefined();
    expect(router.default.stack.find((l: any) => l.route?.path === "/feedback/:id/approve" && l.route.methods.post)).toBeDefined();
    expect(router.default.stack.find((l: any) => l.route?.path === "/feedback/:id/reject" && l.route.methods.post)).toBeDefined();
    expect(router.default.stack.find((l: any) => l.route?.path === "/feedback/batch" && l.route.methods.post)).toBeDefined();
  });

  it("GET /feedback/pending returns only pending entries", async () => {
    const handle = findHandler(router, "get", "/feedback/pending");
    const res = mockRes();
    await handle({}, res);
    expect(res._json.map((f: any) => f.id).sort()).toEqual(["fb_1", "fb_2"]);
  });

  it("POST /feedback/:id/approve marks approved and adds to RAG", async () => {
    const { addDocumentToCatalog } = await import("../rag.js");
    const handle = findHandler(router, "post", "/feedback/:id/approve");
    const res = mockRes();
    await handle({ params: { id: "fb_1" }, body: { correctAnswer: "SELECT 1" } }, res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(storedEntries().find((f: any) => f.id === "fb_1").status).toBe("approved");
    expect(addDocumentToCatalog).toHaveBeenCalledTimes(1);
    expect(addDocumentToCatalog).toHaveBeenCalledWith("fb_1", expect.stringContaining("SELECT 1"), expect.anything(), expect.anything());
  });

  it("POST /feedback/:id/approve returns 404 for unknown id", async () => {
    const handle = findHandler(router, "post", "/feedback/:id/approve");
    const res = mockRes();
    await handle({ params: { id: "missing" }, body: {} }, res);
    expect(res._status).toBe(404);
  });

  it("POST /feedback/:id/approve does not re-add already approved entries", async () => {
    const { addDocumentToCatalog } = await import("../rag.js");
    const handle = findHandler(router, "post", "/feedback/:id/approve");
    const res = mockRes();
    await handle({ params: { id: "fb_3" }, body: {} }, res);
    expect(res._json.message).toMatch(/already approved/i);
    expect(addDocumentToCatalog).not.toHaveBeenCalled();
  });

  it("POST /feedback/:id/reject marks rejected", async () => {
    const handle = findHandler(router, "post", "/feedback/:id/reject");
    const res = mockRes();
    await handle({ params: { id: "fb_2" }, body: {} }, res);
    expect(res._json.success).toBe(true);
    expect(storedEntries().find((f: any) => f.id === "fb_2").status).toBe("rejected");
  });

  it("POST /feedback/batch approves/rejects in one write", async () => {
    const { addDocumentToCatalog } = await import("../rag.js");
    const handle = findHandler(router, "post", "/feedback/batch");
    const res = mockRes();
    await handle({ body: { ids: ["fb_1", "fb_2", "fb_3", "nope"], action: "approve" } }, res);
    expect(res._json).toMatchObject({ success: true, processed: 2 });
    expect(res._json.skipped.sort()).toEqual(["fb_3", "nope"]);
    const stored = storedEntries();
    expect(stored.find((f: any) => f.id === "fb_1").status).toBe("approved");
    expect(stored.find((f: any) => f.id === "fb_2").status).toBe("approved");
    expect(stored.find((f: any) => f.id === "fb_3").status).toBe("approved");
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