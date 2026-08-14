import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "u1", role: "viewer" };
    next();
  },
}));

vi.mock("../db/data-lake.js", () => ({
  getPool: vi.fn(),
}));

import { getPool } from "../db/data-lake.js";

const mockPool = { query: vi.fn() };
(getPool as ReturnType<typeof vi.fn>).mockReturnValue(mockPool);

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

describe("history.router", () => {
  let historyRouter: any;

  beforeAll(async () => {
    historyRouter = await import("../routes/history.router.js");
  });

  beforeEach(() => {
    mockPool.query.mockReset();
  });

  describe("GET /", () => {
    it("returns recent query history scoped to the user", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: "1", query: "SELECT 1", outcome: "success" }],
      });
      const res = mockRes();
      await findHandler(historyRouter, "get", "/")({ query: {}, user: { id: "u1" } }, res);
      expect(res._status).toBe(200);
      expect(res._json.data).toHaveLength(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain("user_id = $1");
      expect(sql).toContain("LIMIT $2");
      expect(params[0]).toBe("u1");
    });

    it("clamps limit to 500", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = mockRes();
      await findHandler(historyRouter, "get", "/")(
        { query: { limit: "9999" }, user: { id: "u1" } },
        res
      );
      expect(mockPool.query.mock.calls[0][1][1]).toBe(500);
    });

    it("defaults limit to 100", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = mockRes();
      await findHandler(historyRouter, "get", "/")({ query: {}, user: { id: null } }, res);
      expect(mockPool.query.mock.calls[0][1][1]).toBe(100);
    });

    it("returns 500 when the query throws", async () => {
      mockPool.query.mockRejectedValueOnce(new Error("db down"));
      const res = mockRes();
      await findHandler(historyRouter, "get", "/")({ query: {}, user: { id: "u1" } }, res);
      expect(res._status).toBe(500);
      expect(res._json.error).toBe("db down");
    });
  });

  describe("GET /stats", () => {
    it("returns aggregate stats", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total_queries: 10, success_count: 8, error_count: 2 }],
      });
      const res = mockRes();
      await findHandler(historyRouter, "get", "/stats")({}, res);
      expect(res._status).toBe(200);
      expect(res._json.data.total_queries).toBe(10);
    });

    it("returns 500 when stats query throws", async () => {
      mockPool.query.mockRejectedValueOnce(new Error("nope"));
      const res = mockRes();
      await findHandler(historyRouter, "get", "/stats")({}, res);
      expect(res._status).toBe(500);
    });
  });

  describe("DELETE /", () => {
    it("returns 403 for non-admin users", async () => {
      const res = mockRes();
      await findHandler(historyRouter, "delete", "/")({ user: { role: "viewer" } }, res);
      expect(res._status).toBe(403);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it("clears history for admins", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = mockRes();
      await findHandler(historyRouter, "delete", "/")({ user: { role: "admin" } }, res);
      expect(res._status).toBe(200);
      expect(mockPool.query.mock.calls[0][0]).toContain("DELETE FROM sql_gen_log");
    });
  });
});