import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../db/data-lake.js", () => ({
  authenticateUser: vi.fn(),
  createUser: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock("../rate-limiter.js", () => ({
  authLimiter: { check: vi.fn() },
  registerLimiter: { check: vi.fn() },
}));

vi.mock("../auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: "u1", role: "viewer" };
    next();
  },
  createToken: vi.fn(() => "mock.jwt.token"),
  verifyToken: vi.fn(),
}));

vi.mock("../middleware/rbac.js", () => ({
  getPermissions: vi.fn((role: string) => [`role:${role}`]),
}));

import { authenticateUser, createUser } from "../db/data-lake.js";
import { verifyToken } from "../auth.js";
import { authLimiter, registerLimiter } from "../rate-limiter.js";

const mockedAuth = authenticateUser as ReturnType<typeof vi.fn>;
const mockedCreate = createUser as ReturnType<typeof vi.fn>;
const mockedVerify = verifyToken as ReturnType<typeof vi.fn>;
const mockedAuthLimit = authLimiter as unknown as { check: ReturnType<typeof vi.fn> };
const mockedRegLimit = registerLimiter as unknown as { check: ReturnType<typeof vi.fn> };

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

describe("auth.router", () => {
  let authRouter: any;
  let login: any;
  let register: any;
  let me: any;

  beforeAll(async () => {
    authRouter = await import("../routes/auth.router.js");
    login = findHandler(authRouter, "post", "/login");
    register = findHandler(authRouter, "post", "/register");
    me = findHandler(authRouter, "get", "/me");
  });

  beforeEach(() => {
    mockedAuth.mockReset();
    mockedCreate.mockReset();
    mockedVerify.mockReset();
    mockedAuthLimit.check.mockReset();
    mockedRegLimit.check.mockReset();
    mockedAuthLimit.check.mockResolvedValue({ allowed: true, message: "", resetInMs: 0 });
    mockedRegLimit.check.mockResolvedValue({ allowed: true, message: "", resetInMs: 0 });
  });

  describe("POST /login", () => {
    it("returns 400 when email or password missing", async () => {
      const res = mockRes();
      await login({ body: { email: "a@b.com" } }, res);
      expect(res._status).toBe(400);
      expect(res._json.error).toMatch(/required/i);
    });

    it("returns 429 when rate limit exceeded", async () => {
      mockedAuthLimit.check.mockResolvedValueOnce({
        allowed: false,
        message: "Too many attempts",
        resetInMs: 5000,
      });
      const res = mockRes();
      await login({ body: { email: "a@b.com", password: "x" }, ip: "1.2.3.4" }, res);
      expect(res._status).toBe(429);
      expect(res._json.resetInMs).toBe(5000);
    });

    it("returns 401 on invalid credentials", async () => {
      mockedAuth.mockResolvedValueOnce(null);
      const res = mockRes();
      await login({ body: { email: "a@b.com", password: "wrong" } }, res);
      expect(res._status).toBe(401);
      expect(res._json.error).toMatch(/invalid/i);
    });

    it("returns a token on successful login", async () => {
      mockedAuth.mockResolvedValueOnce({
        id: "u1",
        name: "A",
        email: "a@b.com",
        role: "analyst",
      });
      const res = mockRes();
      await login({ body: { email: "a@b.com", password: "Secret1" } }, res);
      expect(res._status).toBe(200);
      expect(res._json.token).toBe("mock.jwt.token");
      expect(res._json.user.role).toBe("analyst");
    });

    it("returns 500 when authenticateUser throws", async () => {
      mockedAuth.mockRejectedValueOnce(new Error("db down"));
      const res = mockRes();
      await login({ body: { email: "a@b.com", password: "Secret1" } }, res);
      expect(res._status).toBe(500);
    });
  });

  describe("POST /register", () => {
    it("returns 400 when fields missing", async () => {
      const res = mockRes();
      await register({ body: { email: "a@b.com" } }, res);
      expect(res._status).toBe(400);
    });

    it("returns 400 for a weak password under the new policy", async () => {
      const res = mockRes();
      await register({ body: { email: "a@b.com", password: "weak", name: "X" } }, res);
      expect(res._status).toBe(400);
      expect(res._json.error).toMatch(/at least 8/i);
    });

    it("returns 429 when registration rate limited", async () => {
      mockedRegLimit.check.mockResolvedValueOnce({
        allowed: false,
        message: "too fast",
        resetInMs: 1000,
      });
      const res = mockRes();
      await register({ body: { email: "a@b.com", password: "Secret1!", name: "X" } }, res);
      expect(res._status).toBe(429);
    });

    it("returns 409 on duplicate email", async () => {
      mockedCreate.mockResolvedValueOnce(null);
      const res = mockRes();
      await register({ body: { email: "dup@b.com", password: "Secret1!", name: "X" } }, res);
      expect(res._status).toBe(409);
    });

    it("returns 201 and a token on success", async () => {
      mockedCreate.mockResolvedValueOnce("user_new_1");
      const res = mockRes();
      await register({ body: { email: "a@b.com", password: "Secret1!", name: "X" } }, res);
      expect(res._status).toBe(201);
      expect(res._json.user.role).toBe("viewer");
    });
  });

  describe("GET /me", () => {
    it("returns 401 without a Bearer token", async () => {
      const res = mockRes();
      await me({ headers: {} }, res);
      expect(res._status).toBe(401);
    });

    it("returns 401 for an invalid token", async () => {
      mockedVerify.mockReturnValueOnce({ success: false, error: "Invalid token signature" });
      const res = mockRes();
      await me({ headers: { authorization: "Bearer bad.token.here" } }, res);
      expect(res._status).toBe(401);
    });

    it("returns the user from a valid token", async () => {
      mockedVerify.mockReturnValueOnce({
        success: true,
        payload: { userId: "u9", role: "admin" },
      });
      const res = mockRes();
      await me({ headers: { authorization: "Bearer good.token.here" } }, res);
      expect(res._status).toBe(200);
      expect(res._json.user).toEqual({ id: "u9", role: "admin" });
    });
  });

  describe("GET /permissions", () => {
    it("returns role and permissions when authenticated", async () => {
      const handler = findHandler(authRouter, "get", "/permissions");
      const res = mockRes();
      await handler({ user: { role: "admin" } }, res);
      expect(res._status).toBe(200);
      expect(res._json.role).toBe("admin");
      expect(res._json.permissions).toEqual(["role:admin"]);
    });
  });
});