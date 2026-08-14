import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/pool.js", () => ({
  getPool: vi.fn(),
}));

vi.mock("../routes/shared.js", () => ({
  log: vi.fn(),
}));

import { getPool } from "../db/pool.js";

const mockedGetPool = getPool as ReturnType<typeof vi.fn>;

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

function makePool(rowsForSql: (sql: string, params?: any[]) => any[]) {
  return { query: vi.fn((sql: string, params?: any[]) => Promise.resolve({ rows: rowsForSql(sql, params) })) };
}

describe("sharing.router", () => {
  let mod: any;
  let pool: { query: ReturnType<typeof vi.fn> };

  const handlers: Record<string, any> = {};

  beforeEach(() => {
    pool = makePool(() => []);
    mockedGetPool.mockReset();
    mockedGetPool.mockReturnValue(pool);
  });

  beforeAll(async () => {
    mod = await import("../routes/sharing.router.js");
    handlers.listTeams = findHandler(mod, "get", "/teams");
    handlers.createTeam = findHandler(mod, "post", "/teams");
    handlers.addMember = findHandler(mod, "post", "/teams/:id/members");
    handlers.removeMember = findHandler(mod, "delete", "/teams/:id/members/:userId");
    handlers.share = findHandler(mod, "post", "/sharing");
    handlers.listSharing = findHandler(mod, "get", "/sharing");
    handlers.revokeShare = findHandler(mod, "delete", "/sharing/:shareId");
    handlers.sharedWithMe = findHandler(mod, "get", "/shared-with-me");
  });

  describe("GET /teams", () => {
    it("lists teams for the current user", async () => {
      pool.query.mockImplementation(() =>
        Promise.resolve({ rows: [{ id: "t1", name: "Analytics", member_count: 3 }] })
      );
      const res = mockRes();
      await handlers.listTeams({ user: { userId: "u1" } }, res);
      expect(res._status).toBe(200);
      expect(res._json.data).toHaveLength(1);
    });

    it("returns 500 when the query fails", async () => {
      pool.query.mockRejectedValueOnce(new Error("db down"));
      const res = mockRes();
      await handlers.listTeams({ user: { userId: "u1" } }, res);
      expect(res._status).toBe(500);
    });
  });

  describe("POST /teams", () => {
    it("rejects a team without a name", async () => {
      const res = mockRes();
      await handlers.createTeam({ user: { userId: "u1" }, body: {} }, res);
      expect(res._status).toBe(400);
      expect(res._json.error).toMatch(/name is required/);
    });

    it("creates a team and registers the creator as admin member", async () => {
      const res = mockRes();
      await handlers.createTeam({ user: { userId: "u1" }, body: { name: "Sales" } }, res);
      expect(res._status).toBe(201);
      expect(res._json.data.name).toBe("Sales");
      expect(pool.query).toHaveBeenCalledTimes(2);
      const inserts = (pool.query as any).mock.calls.map((c: any[]) => c[0]);
      expect(inserts[0]).toContain("INSERT INTO teams");
      expect(inserts[1]).toContain("INSERT INTO team_members");
      expect((pool.query as any).mock.calls[0][1][3]).toBe("u1");
    });

    it("returns 500 when creation fails", async () => {
      pool.query.mockRejectedValueOnce(new Error("insert failed"));
      const res = mockRes();
      await handlers.createTeam({ user: { userId: "u1" }, body: { name: "X" } }, res);
      expect(res._status).toBe(500);
    });
  });

  describe("POST /teams/:id/members", () => {
    it("rejects a request without user_id", async () => {
      const res = mockRes();
      await handlers.addMember({ user: { userId: "u1" }, params: { id: "t1" }, body: {} }, res);
      expect(res._status).toBe(400);
    });

    it("forbids non-admin members from adding users", async () => {
      pool.query.mockImplementation((sql: string) =>
        Promise.resolve({ rows: sql.includes("SELECT created_by") ? [] : [] })
      );
      const res = mockRes();
      await handlers.addMember(
        { user: { userId: "u1", role: "analyst" }, params: { id: "t1" }, body: { user_id: "u2" } },
        res
      );
      expect(res._status).toBe(403);
    });

    it("lets the team creator add a member", async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT created_by")) return Promise.resolve({ rows: [{ created_by: "u1" }] });
        return Promise.resolve({ rows: [] });
      });
      const res = mockRes();
      await handlers.addMember(
        { user: { userId: "u1", role: "analyst" }, params: { id: "t1" }, body: { user_id: "u2" } },
        res
      );
      expect(res._status).toBe(201);
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it("lets a team admin member add users", async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT created_by")) return Promise.resolve({ rows: [{ created_by: "boss" }] });
        return Promise.resolve({ rows: [{ "1": 1 }] });
      });
      const res = mockRes();
      await handlers.addMember(
        { user: { userId: "u1" }, params: { id: "t1" }, body: { user_id: "u3", role: "editor" } },
        res
      );
      expect(res._status).toBe(201);
    });
  });

  describe("DELETE /teams/:id/members/:userId", () => {
    it("forbids non-creator removal", async () => {
      const res = mockRes();
      await handlers.removeMember(
        { user: { userId: "u1", role: "viewer" }, params: { id: "t1", userId: "u2" } },
        res
      );
      expect(res._status).toBe(403);
    });

    it("removes a member as the team creator", async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT created_by")) return Promise.resolve({ rows: [{ created_by: "u1" }] });
        return Promise.resolve({ rows: [] });
      });
      const res = mockRes();
      await handlers.removeMember(
        { user: { userId: "u1" }, params: { id: "t1", userId: "u2" } },
        res
      );
      expect(res._status).toBe(200);
      expect(pool.query).toHaveBeenLastCalledWith(
        "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2",
        ["t1", "u2"]
      );
    });
  });

  describe("POST /sharing", () => {
    it("requires resource_type and resource_id", async () => {
      const res = mockRes();
      await handlers.share({ user: { userId: "u1" }, body: {} }, res);
      expect(res._status).toBe(400);
    });

    it("requires a grantee", async () => {
      const res = mockRes();
      await handlers.share(
        { user: { userId: "u1" }, body: { resource_type: "catalog", resource_id: "sales_raw" } },
        res
      );
      expect(res._status).toBe(400);
      expect(res._json.error).toMatch(/granted_to_user_id or granted_to_team_id/);
    });

    it("forbids non-owners from sharing", async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("owner_id")) return Promise.resolve({ rows: [{ owner_id: "other" }] });
        return Promise.resolve({ rows: [] });
      });
      const res = mockRes();
      await handlers.share(
        { user: { userId: "u1", role: "analyst" }, body: { resource_type: "catalog", resource_id: "sales_raw", granted_to_user_id: "u2" } },
        res
      );
      expect(res._status).toBe(403);
    });

    it("shares a resource as the owner", async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("owner_id")) return Promise.resolve({ rows: [{ owner_id: "u1" }] });
        return Promise.resolve({ rows: [] });
      });
      const res = mockRes();
      await handlers.share(
        { user: { userId: "u1", role: "analyst" }, body: { resource_type: "catalog", resource_id: "sales_raw", granted_to_team_id: "t1", permission: "edit" } },
        res
      );
      expect(res._status).toBe(201);
      const insertCall = (pool.query as any).mock.calls.find((c: any[]) => c[0].includes("INSERT INTO shared_resources"));
      expect(insertCall[1][3]).toBe("t1");
      expect(insertCall[1][4]).toBe("edit");
    });

    it("lets admins share any resource", async () => {
      const res = mockRes();
      await handlers.share(
        { user: { userId: "admin1", role: "admin" }, body: { resource_type: "file", resource_id: "f1", granted_to_user_id: "u2" } },
        res
      );
      expect(res._status).toBe(201);
      expect((pool.query as any).mock.calls.length).toBe(1);
    });
  });

  describe("GET /sharing", () => {
    it("requires type and id", async () => {
      const res = mockRes();
      await handlers.listSharing({ user: { userId: "u1" }, query: {} }, res);
      expect(res._status).toBe(400);
    });

    it("returns share entries for the owner", async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("owner_id")) return Promise.resolve({ rows: [{ owner_id: "u1" }] });
        return Promise.resolve({ rows: [{ share_id: "s1", permission: "view" }] });
      });
      const res = mockRes();
      await handlers.listSharing({ user: { userId: "u1" }, query: { type: "catalog", id: "sales_raw" } }, res);
      expect(res._status).toBe(200);
      expect(res._json.data[0].share_id).toBe("s1");
    });
  });

  describe("DELETE /sharing/:shareId", () => {
    it("returns 404 for an unknown share", async () => {
      const res = mockRes();
      await handlers.revokeShare({ user: { userId: "u1" }, params: { shareId: "nope" } }, res);
      expect(res._status).toBe(404);
    });

    it("forbids unrelated users from revoking", async () => {
      pool.query.mockImplementation(() =>
        Promise.resolve({ rows: [{ id: "s1", resource_type: "catalog", resource_id: "sales_raw", granted_by: "owner" }] })
      );
      const res = mockRes();
      await handlers.revokeShare({ user: { userId: "u1", role: "analyst" }, params: { shareId: "s1" } }, res);
      expect(res._status).toBe(403);
    });

    it("lets the grantor revoke access", async () => {
      pool.query.mockImplementation(() =>
        Promise.resolve({ rows: [{ id: "s1", resource_type: "catalog", resource_id: "sales_raw", granted_by: "u1" }] })
      );
      const res = mockRes();
      await handlers.revokeShare({ user: { userId: "u1" }, params: { shareId: "s1" } }, res);
      expect(res._status).toBe(200);
      expect(pool.query).toHaveBeenLastCalledWith("DELETE FROM shared_resources WHERE id = $1", ["s1"]);
    });

    it("lets the resource owner revoke even if they did not grant", async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, resource_type")) {
          return Promise.resolve({ rows: [{ id: "s1", resource_type: "catalog", resource_id: "sales_raw", granted_by: "other" }] });
        }
        if (sql.includes("owner_id")) return Promise.resolve({ rows: [{ owner_id: "u1" }] });
        return Promise.resolve({ rows: [] });
      });
      const res = mockRes();
      await handlers.revokeShare({ user: { userId: "u1", role: "analyst" }, params: { shareId: "s1" } }, res);
      expect(res._status).toBe(200);
    });

    it("returns 500 when the lookup fails", async () => {
      pool.query.mockRejectedValueOnce(new Error("boom"));
      const res = mockRes();
      await handlers.revokeShare({ user: { userId: "u1" }, params: { shareId: "s1" } }, res);
      expect(res._status).toBe(500);
    });
  });

  describe("GET /shared-with-me", () => {
    it("resolves catalog names", async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT sr.id AS share_id")) {
          return Promise.resolve({ rows: [{ share_id: "s1", resource_type: "catalog", resource_id: "sales_raw", permission: "view" }] });
        }
        return Promise.resolve({ rows: [{ table_name: "sales_raw" }] });
      });
      const res = mockRes();
      await handlers.sharedWithMe({ user: { userId: "u1" } }, res);
      expect(res._status).toBe(200);
      expect(res._json.data[0].name).toBe("sales_raw");
    });

    it("falls back to the resource id when catalog lookup is empty", async () => {
      pool.query.mockImplementation((sql: string) => {
        if (sql.includes("SELECT sr.id AS share_id")) {
          return Promise.resolve({ rows: [{ share_id: "s2", resource_type: "catalog", resource_id: "ghost" }] });
        }
        return Promise.resolve({ rows: [] });
      });
      const res = mockRes();
      await handlers.sharedWithMe({ user: { userId: "u1" } }, res);
      expect(res._json.data[0].name).toBe("ghost");
    });
  });

  describe("canAccessResource", () => {
    it("grants access to owners", async () => {
      const p = makePool((sql: string) =>
        sql.includes("owner_id") ? [{ owner_id: "u1", visibility: "private" }] : []
      );
      expect(await mod.canAccessResource(p, "catalog", "sales_raw", "u1")).toBe(true);
    });

    it("grants access when visibility is shared", async () => {
      const p = makePool((sql: string) =>
        sql.includes("owner_id") ? [{ owner_id: "u2", visibility: "shared" }] : []
      );
      expect(await mod.canAccessResource(p, "catalog", "sales_raw", "u1")).toBe(true);
    });

    it("returns false for unknown catalog tables", async () => {
      const p = makePool(() => []);
      expect(await mod.canAccessResource(p, "catalog", "missing", "u1")).toBe(false);
    });

    it("returns false for non-catalog resources without shares", async () => {
      const p = makePool(() => []);
      expect(await mod.canAccessResource(p, "file", "f1", "u1")).toBe(false);
    });

    it("returns true when a matching share with sufficient permission exists", async () => {
      const p = makePool((sql: string) => {
        if (sql.includes("owner_id")) return [{ owner_id: "u2", visibility: "private" }];
        return sql.includes("shared_resources") ? [{ "1": 1 }] : [];
      });
      expect(await mod.canAccessResource(p, "catalog", "sales_raw", "u1", "edit")).toBe(true);
    });
  });
});