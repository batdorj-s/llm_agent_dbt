import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/pool.js", () => ({
  getPool: vi.fn(),
}));

vi.mock("../db/data-lake.js", () => ({
  getPool: vi.fn(),
}));

import { getPool } from "../db/pool.js";
import { deriveAction, auditWrites, writeAuditLog } from "../middleware/audit.js";

const mockedPool = { query: vi.fn() };
(getPool as ReturnType<typeof vi.fn>).mockReturnValue(mockedPool);

function makeReq(method: string, path: string, user?: unknown) {
  const req: any = {
    method,
    path,
    originalUrl: path,
    ip: "127.0.0.1",
    reqId: "req-1",
    user,
  };
  return req;
}

function makeRes() {
  const listeners: Record<string, () => void> = {};
  const res: any = {
    statusCode: 200,
    on: vi.fn((event: string, cb: () => void) => {
      listeners[event] = cb;
      return res;
    }),
    fireFinish: () => listeners["finish"]?.(),
  };
  return res;
}

describe("observe/audit middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPool.query.mockReset();
    mockedPool.query.mockResolvedValue({ rows: [] });
    process.env.NODE_ENV = "development";
  });

  describe("deriveAction", () => {
    it("maps admin feedback approve/reject to feedback.decision", () => {
      expect(deriveAction("POST", "/api/admin/feedback/fb_1/approve")).toBe("feedback.decision");
      expect(deriveAction("POST", "/api/admin/feedback/fb_1/reject")).toBe("feedback.decision");
    });

    it("maps auth login to auth.login", () => {
      expect(deriveAction("POST", "/api/auth/login")).toBe("auth.login");
    });

    it("maps generic admin writes to admin.action", () => {
      expect(deriveAction("DELETE", "/api/admin/something")).toBe("admin.action");
    });

    it("falls back to method.generic for unknown paths", () => {
      expect(deriveAction("PUT", "/api/unmapped-route")).toBe("put.generic");
    });

    it("strips query strings before mapping", () => {
      expect(deriveAction("POST", "/api/admin/feedback?limit=5")).toBe("feedback.update");
    });
  });

  describe("writeAuditLog", () => {
    it("inserts a row with details JSON", async () => {
      await writeAuditLog({
        action: "auth.login",
        method: "POST",
        path: "/api/auth/login",
        status: 200,
        userId: "u1",
        ip: "127.0.0.1",
        requestId: "req-1",
        details: { email: "admin@example.com" },
      });
      expect(mockedPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockedPool.query.mock.calls[0];
      expect(String(sql)).toContain("INSERT INTO audit_log");
      expect(params[0]).toBe("u1");
      expect(params[5]).toBe("127.0.0.1");
      expect(JSON.parse(params[7])).toEqual({ email: "admin@example.com" });
    });

    it("swallows DB errors without throwing", async () => {
      mockedPool.query.mockRejectedValue(new Error("connection refused"));
      await expect(writeAuditLog({
        action: "auth.login",
        method: "POST",
        path: "/api/auth/login",
        status: 401,
      })).resolves.toBeUndefined();
    });
  });

  describe("auditWrites", () => {
    it("passes through GET requests without logging", () => {
      const req = makeReq("GET", "/api/admin/summary");
      const res = makeRes();
      const next = vi.fn();
      auditWrites(req, res, next);
      expect(next).toHaveBeenCalled();
      res.fireFinish();
      expect(mockedPool.query).not.toHaveBeenCalled();
    });

    it("logs POST requests on finish", () => {
      const req = makeReq("POST", "/api/admin/feedback/batch", { userId: "u1" });
      const res = makeRes();
      const next = vi.fn();
      auditWrites(req, res, next);
      expect(next).toHaveBeenCalled();
      res.fireFinish();
      const [sql, params] = mockedPool.query.mock.calls[0];
      expect(String(sql)).toContain("INSERT INTO audit_log");
      expect(params[0]).toBe("u1");
      expect(params[1]).toBe("feedback.batch");
      expect(params[4]).toBe(200);
    });

    it("skips health endpoints", () => {
      const req = makeReq("POST", "/health/check");
      const res = makeRes();
      const next = vi.fn();
      auditWrites(req, res, next);
      res.fireFinish();
      expect(mockedPool.query).not.toHaveBeenCalled();
    });
  });
});