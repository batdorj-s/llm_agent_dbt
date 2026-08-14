import { describe, it, expect, vi, beforeEach } from "vitest";

const fakePool = { query: vi.fn() };

vi.mock("../db/pool.js", () => ({
  getPool: vi.fn(() => fakePool),
}));

vi.mock("../db/feedback-repository.js", () => ({
  listFeedback: vi.fn(async () => []),
  feedbackCounts: vi.fn(async () => ({ pending: 3, approved: 7 })),
}));

import summaryRouter from "../routes/admin-summary.router.js";

function handlerFor(method: string, path: string): any {
  const layer = (summaryRouter.stack as any[]).find(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
  );
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

function makeReq(): any {
  return {
    method: "GET",
    path: "/api/admin/summary",
    originalUrl: "/api/admin/summary",
    ip: "127.0.0.1",
    user: { userId: "user-admin-001", role: "admin" },
  };
}

function makeRes(): any {
  const res: any = {
    statusCode: 200,
    _json: null,
    json: vi.fn((body: unknown) => {
      res._json = body;
      return res;
    }),
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
  };
  return res;
}

describe("Admin Summary Router — outcome classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies granular outcomes into success/failure counts", async () => {
    fakePool.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sql_gen_log")) {
        return {
          rows: [{
            total: 261,
            succeeded: 212,
            failed: 49,
            last_24h: 4,
          }],
        };
      }
      return { rows: [{ count: 5 }] };
    });

    const req = makeReq();
    const res = makeRes();
    await handlerFor("get", "/summary")(req, res);

    const body = res._json;
    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.counts.sqlLogs).toBe(261);
    expect(body.data.counts.sqlSucceeded).toBe(212);
    expect(body.data.counts.sqlFailed).toBe(49);
    expect(body.data.counts.sqlLast24h).toBe(4);
  });

  it("sends a suffix-based LIKE query for outcome classification", async () => {
    fakePool.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sql_gen_log")) {
        return { rows: [{ total: 0, succeeded: 0, failed: 0, last_24h: 0 }] };
      }
      return { rows: [{ count: 0 }] };
    });

    const req = makeReq();
    const res = makeRes();
    await handlerFor("get", "/summary")(req, res);

    const sqlGenLogQuery = fakePool.query.mock.calls.map((c) => String(c[0])).find((s) => s.includes("FROM sql_gen_log"));
    expect(sqlGenLogQuery).toBeDefined();
    expect(sqlGenLogQuery).toContain("outcome LIKE '%success'");
    expect(sqlGenLogQuery).not.toContain("outcome = 'success'");
  });

  it("returns 500 with generic message when the pool fails", async () => {
    fakePool.query.mockRejectedValue(new Error("connection refused"));

    const req = makeReq();
    const res = makeRes();
    await handlerFor("get", "/summary")(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._json).toEqual({ error: "Failed to build admin summary" });
  });
});
