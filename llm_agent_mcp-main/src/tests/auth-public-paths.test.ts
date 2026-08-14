import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../multi-agent.js";

let createToken: (userId: string, role: UserRole) => string;

const ORIGINAL_ENV = { ...process.env };

function makeReq(path: string, authHeader?: string): Request {
  const req = { path, headers: { authorization: authHeader } } as unknown as Request;
  return req;
}

function makeRes(): { res: Response; statusCode: () => number; body: unknown } {
  const state = { statusCode: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, statusCode: () => state.statusCode, body: state.body };
}

describe("requireAuth — data endpoints must NOT be public", () => {
  let requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  let nextSpy: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "test-secret-please-change-0123456789abcdef";
    delete process.env.ALLOW_DEV_AUTH;
    vi.resetModules();
    const mod = await import("../auth.js");
    requireAuth = mod.requireAuth;
    createToken = mod.createToken;
    nextSpy = vi.fn();
  });

  beforeEach(() => {
    nextSpy = vi.fn();
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const protectedPaths = [
    "/api/kpi/sales",
    "/api/kpi-history",
    "/api/dashboard/computed-metrics",
    "/api/finance-charts",
    "/api/finance-audit",
    "/api/table-passport",
    "/api/finance-mapper/upload",
    "/api/teams",
    "/api/sharing",
  ];

  for (const path of protectedPaths) {
    it(`rejects anonymous request to ${path} with 401`, async () => {
      const { res, statusCode } = makeRes();
      requireAuth(makeReq(path), res, nextSpy as NextFunction);
      expect(statusCode()).toBe(401);
      expect(nextSpy).not.toHaveBeenCalled();
    });

    it(`rejects request to ${path} with invalid token with 401`, async () => {
      const { res, statusCode } = makeRes();
      requireAuth(
        makeReq(path, "Bearer invalid.token.value"),
        res,
        nextSpy as NextFunction
      );
      expect(statusCode()).toBe(401);
    });
  }

  it("accepts valid token on data endpoint and sets userId/role", async () => {
    const token = createToken("user-1", "admin");
    const req = makeReq("/api/kpi/sales", `Bearer ${token}`) as Request & {
      userId?: string;
      role?: string;
    };
    const { res, statusCode } = makeRes();
    requireAuth(req, res, nextSpy as NextFunction);
    expect(statusCode()).toBe(0);
    expect(nextSpy).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe("user-1");
    expect(req.role).toBe("admin");
  });

  const publicPaths = ["/api/health", "/api/status", "/api/auth/login", "/api/auth/register"];

  for (const path of publicPaths) {
    it(`still allows anonymous access to ${path}`, async () => {
      const { res, statusCode } = makeRes();
      requireAuth(makeReq(path), res, nextSpy as NextFunction);
      expect(statusCode()).toBe(0);
    });
  }
});
