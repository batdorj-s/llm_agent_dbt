import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../routes/shared.js", () => ({
  log: vi.fn(),
}));

vi.mock("../db/pool.js", () => ({
  getPool: vi.fn(),
}));

import { getPool } from "../db/pool.js";

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

const keyRow = {
  id: "apikey_abc",
  user_id: "u1",
  name: "ci-key",
  key_prefix: "a1b2",
  permissions: ["read"],
  expires_at: null,
  is_active: true,
  last_used_at: null,
  created_at: "2026-01-01",
};

describe("api-keys.router", () => {
  let apiKeysRouter: any;

  beforeAll(async () => {
    apiKeysRouter = await import("../routes/api-keys.router.js");
  });

  beforeEach(() => {
    mockPool.query.mockReset();
  });

  describe("requireApiKey middleware", () => {
    it("returns 401 when X-API-Key header is missing", async () => {
      const { requireApiKey } = apiKeysRouter;
      const res = mockRes();
      await requireApiKey({ headers: {} }, res, vi.fn());
      expect(res._status).toBe(401);
      expect(res._json.error).toMatch(/API key required/i);
    });

    it("returns 401 for unknown key hash", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = mockRes();
      await apiKeysRouter.requireApiKey({ headers: { "x-api-key": "sk_deadbeef" } }, res, vi.fn());
      expect(res._status).toBe(401);
      expect(res._json.error).toMatch(/Invalid or inactive/i);
    });

    it("returns 401 for expired keys", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...keyRow, expires_at: "2020-01-01T00:00:00Z" }],
      });
      const res = mockRes();
      await apiKeysRouter.requireApiKey({ headers: { "x-api-key": "sk_expired" } }, res, vi.fn());
      expect(res._status).toBe(401);
      expect(res._json.error).toMatch(/expired/i);
    });

    it("calls next() and attaches key info for valid keys", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [keyRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const req: any = { headers: { "x-api-key": "sk_valid" } };
      const next = vi.fn();
      await apiKeysRouter.requireApiKey(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
      expect(req.apiKeyInfo).toBe(keyRow);
      expect(req.user.role).toBe("admin");
    });

    it("returns 500 when the query throws", async () => {
      mockPool.query.mockRejectedValueOnce(new Error("db down"));
      const res = mockRes();
      await apiKeysRouter.requireApiKey({ headers: { "x-api-key": "sk_x" } }, res, vi.fn());
      expect(res._status).toBe(500);
    });
  });

  describe("POST /admin/api-keys", () => {
    const handle = () => findHandler(apiKeysRouter, "post", "/admin/api-keys");

    it("returns 400 when name is missing", async () => {
      const res = mockRes();
      await handle()({ body: {} }, res);
      expect(res._status).toBe(400);
      expect(res._json.error).toMatch(/name is required/i);
    });

    it("creates a key and returns it once with hash-only storage", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = mockRes();
      await handle()({ body: { name: "ci", expiresInDays: 30 }, user: { userId: "u1" } }, res);
      expect(res._status).toBe(201);
      expect(res._json.data.key).toMatch(/^sk_[a-f0-9]{8}_/);
      expect(res._json.data.keyPrefix).toHaveLength(8);
      expect(res._json.data.expiresAt).toBeDefined();

      const insert = mockPool.query.mock.calls[0];
      expect(insert[0]).toContain("INSERT INTO api_keys");
      expect(insert[1][2]).toMatch(/^[a-f0-9]{64}$/);
      expect(insert[1][3]).toBe(res._json.data.keyPrefix);
    });
  });

  describe("GET /admin/api-keys", () => {
    it("lists keys without exposing full key material", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [keyRow] });
      const res = mockRes();
      await findHandler(apiKeysRouter, "get", "/admin/api-keys")({}, res);
      expect(res._status).toBe(200);
      expect(res._json.data[0]).toEqual({
        id: keyRow.id,
        keyPrefix: keyRow.key_prefix,
        name: keyRow.name,
        permissions: keyRow.permissions,
        expiresAt: keyRow.expires_at,
        isActive: keyRow.is_active,
        lastUsedAt: keyRow.last_used_at,
        createdAt: keyRow.created_at,
      });
      expect(JSON.stringify(res._json.data)).not.toContain("key_hash");
    });
  });

  describe("PATCH /admin/api-keys/:id", () => {
    it("returns 400 for invalid isActive type", async () => {
      const res = mockRes();
      await findHandler(apiKeysRouter, "patch", "/admin/api-keys/:id")(
        { params: { id: "k1" }, body: { isActive: "yes" } },
        res
      );
      expect(res._status).toBe(400);
    });

    it("returns 400 when no fields provided", async () => {
      const res = mockRes();
      await findHandler(apiKeysRouter, "patch", "/admin/api-keys/:id")(
        { params: { id: "k1" }, body: {} },
        res
      );
      expect(res._status).toBe(400);
      expect(res._json.error).toMatch(/At least one field/i);
    });

    it("returns 404 when the key does not exist", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = mockRes();
      await findHandler(apiKeysRouter, "patch", "/admin/api-keys/:id")(
        { params: { id: "missing" }, body: { isActive: false } },
        res
      );
      expect(res._status).toBe(404);
    });

    it("updates fields with dynamic SET clause and parameterized values", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...keyRow, name: "renamed" }],
      });
      const res = mockRes();
      await findHandler(apiKeysRouter, "patch", "/admin/api-keys/:id")(
        { params: { id: "k1" }, body: { name: "renamed", isActive: false } },
        res
      );
      expect(res._status).toBe(200);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain("UPDATE api_keys SET");
      expect(sql).toContain("$1");
      expect(params).toContain("renamed");
      expect(params[params.length - 1]).toBe("k1");
    });
  });

  describe("DELETE /admin/api-keys/:id", () => {
    it("revokes a key with 200", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: "k1" }] });
      const res = mockRes();
      await findHandler(apiKeysRouter, "delete", "/admin/api-keys/:id")(
        { params: { id: "k1" } },
        res
      );
      expect(res._status).toBe(200);
      expect(mockPool.query.mock.calls[0][0]).toContain("is_active = false");
    });

    it("returns 404 for unknown key", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = mockRes();
      await findHandler(apiKeysRouter, "delete", "/admin/api-keys/:id")(
        { params: { id: "missing" } },
        res
      );
      expect(res._status).toBe(404);
    });
  });
});