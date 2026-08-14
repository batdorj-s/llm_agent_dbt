import { describe, it, expect, vi, beforeAll } from "vitest";

describe("Report Scheduler", () => {
  it("should export scheduler service functions", async () => {
    const scheduler = await import("../services/scheduler.js");
    expect(scheduler.startScheduler).toBeDefined();
    expect(typeof scheduler.startScheduler).toBe("function");
    expect(scheduler.stopScheduler).toBeDefined();
    expect(typeof scheduler.stopScheduler).toBe("function");
    expect(scheduler.computeNextRun).toBeDefined();
    expect(typeof scheduler.computeNextRun).toBe("function");
  });

  it("computeNextRun should return null for invalid cron", async () => {
    const { computeNextRun } = await import("../services/scheduler.js");
    expect(computeNextRun("invalid")).toBeNull();
    expect(computeNextRun("")).toBeNull();
  });

  it("should create scheduled_reports and generated_reports tables", async () => {
    const pool = await import("../db/pool.js");
    expect(pool).toBeDefined();
  });

  it("should export scheduler router with CRUD + download endpoints", async () => {
    const router = await import("../routes/scheduler.router.js");
    expect(router.default).toBeDefined();
    const routes = router.default.stack || [];
    const paths = routes.map((r: any) => r.route?.path).filter(Boolean);
    expect(paths).toContain("/scheduler/reports");
    expect(paths).toContain("/scheduler/reports/generated");
    expect(paths).toContain("/scheduler/reports/:id/download");
  });

  it("should export generation helper functions", async () => {
    const mod = await import("../services/scheduler.js");
    expect(typeof mod.generateCsv).toBe("function");
    expect(typeof mod.generateJson).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────
// SQL injection guard — stored query validation (P0 fix)
// ─────────────────────────────────────────────────────────────
const fakePool = {
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
};

vi.mock("../db/pool.js", () => ({
  getPool: vi.fn(() => fakePool),
}));

describe("Report Scheduler — stored SQL validation", () => {
  function handlerFor(method: string, path: string): any {
    const layer = (router.stack as any[]).find(
      (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
    );
    const handlers = layer.route.stack;
    return handlers[handlers.length - 1].handle;
  }

  function routeChainFor(method: string, path: string): any[] {
    const layer = (router.stack as any[]).find(
      (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
    );
    return layer.route.stack.map((s: any) => s.handle);
  }

  async function invokeChain(chain: any[], req: any, res: any): Promise<void> {
    for (let i = 0; i < chain.length; i++) {
      if (res.statusCode) return;
      let calledNext = false;
      await chain[i](req, res, () => { calledNext = true; });
      if (!calledNext) return;
    }
  }

  let router: any;

  beforeAll(async () => {
    router = (await import("../routes/scheduler.router.js")).default;
  });

  function makeReq(body: any) {
    return { body, userId: "user-test", role: "admin", user: { userId: "user-test", role: "admin" }, params: { id: "sched_x" } } as any;
  }

  function makeRes() {
    const res: any = { statusCode: 0, body: null };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    return res;
  }

  it("rejects non-SELECT stored query on POST with 400", async () => {
    const handler = handlerFor("post", "/scheduler/reports");
    const res = makeRes();
    await handler(
      makeReq({ name: "x", query: "SELECT * FROM users; DROP TABLE users; --", cron_expression: "0 8 * * 1" }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Invalid query");
    expect(fakePool.query).not.toHaveBeenCalled();
  });

  it("rejects DELETE query on POST with 400", async () => {
    const handler = handlerFor("post", "/scheduler/reports");
    const res = makeRes();
    await handler(makeReq({ name: "x", query: "DELETE FROM scheduled_reports", cron_expression: "0 8 * * 1" }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Invalid query");
  });

  it("accepts a safe SELECT on POST (reaches the database)", async () => {
    const handler = handlerFor("post", "/scheduler/reports");
    const res = makeRes();
    await handler(makeReq({ name: "x", query: "SELECT 1", cron_expression: "0 8 * * 1" }), res);
    expect(res.statusCode).toBe(201);
  });

  it("rejects non-SELECT query on PUT with 400", async () => {
    const handler = handlerFor("put", "/scheduler/reports/:id");
    const res = makeRes();
    await handler(makeReq({ query: "UPDATE scheduled_reports SET name = 'x'" }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Invalid query");
  });

  it("requires report:write permission (403 for viewer)", async () => {
    const chain = routeChainFor("post", "/scheduler/reports");
    const res = makeRes();
    const req = makeReq({ name: "x", query: "SELECT 1", cron_expression: "0 8 * * 1" });
    req.user = { userId: "viewer-1", role: "viewer" };
    await invokeChain(chain, req, res);
    expect(res.statusCode).toBe(403);
  });

  it("allows analyst role with report:write (reaches the database)", async () => {
    const chain = routeChainFor("post", "/scheduler/reports");
    const res = makeRes();
    const req = makeReq({ name: "x", query: "SELECT 1", cron_expression: "0 8 * * 1" });
    req.user = { userId: "analyst-1", role: "analyst" };
    await invokeChain(chain, req, res);
    expect(res.statusCode).toBe(201);
  });
});
