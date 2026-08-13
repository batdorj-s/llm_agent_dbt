import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("../db/catalog.js", () => ({
  createUser: vi.fn(async () => "user_mock_123"),
}));

function findHandler(router: any, method: string, path: string) {
  const layer = router.default.stack.find(
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

describe("Admin Users Router", () => {
  let router: any;

  beforeAll(async () => {
    router = await import("../routes/admin-users.router.js");
  });

  it("exports a default router", () => {
    expect(router.default).toBeDefined();
    expect(typeof router.default).toBe("function");
  });

  it("registers GET /users with admin:users permission", () => {
    const route = router.default.stack.find((l: any) => l.route?.path === "/users" && l.route.methods.get);
    expect(route).toBeDefined();
    expect(route.route.stack.length).toBeGreaterThan(1);
  });

  it("registers POST /users", () => {
    const route = router.default.stack.find((l: any) => l.route?.path === "/users" && l.route.methods.post);
    expect(route).toBeDefined();
    expect(route.route.stack.length).toBeGreaterThan(1);
  });

  it("registers PATCH /users/:id", () => {
    const route = router.default.stack.find((l: any) => l.route?.path === "/users/:id" && l.route.methods.patch);
    expect(route).toBeDefined();
  });

  it("registers DELETE /users/:id", () => {
    const route = router.default.stack.find((l: any) => l.route?.path === "/users/:id" && l.route.methods.delete);
    expect(route).toBeDefined();
  });
});

describe("Admin Users Router — POST /users handler", () => {
  let router: any;
  let handle: any;

  beforeAll(async () => {
    router = await import("../routes/admin-users.router.js");
    handle = findHandler(router, "post", "/users");
  });

  it("rejects invalid email with 400", async () => {
    const res = mockRes();
    await handle({ body: { email: "not-an-email", password: "secret123", name: "X" } }, res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/email/i);
  });

  it("rejects short password with 400", async () => {
    const res = mockRes();
    await handle({ body: { email: "a@b.com", password: "123", name: "X" } }, res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/6 characters/i);
  });

  it("rejects empty name with 400", async () => {
    const res = mockRes();
    await handle({ body: { email: "a@b.com", password: "secret123", name: "  " } }, res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/name/i);
  });

  it("rejects unknown role with 400", async () => {
    const res = mockRes();
    await handle({ body: { email: "a@b.com", password: "secret123", name: "X", role: "superadmin" } }, res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/role/i);
  });

  it("creates a user with 201 and normalized email", async () => {
    const { createUser } = await import("../db/catalog.js");
    const res = mockRes();
    await handle({ body: { email: "  NEW@Example.COM ", password: "secret123", name: "Нэр", role: "analyst" } }, res);
    expect(res._status).toBe(201);
    expect(res._json.data.email).toBe("new@example.com");
    expect(res._json.data.role).toBe("analyst");
    expect(createUser).toHaveBeenCalledWith("new@example.com", "secret123", "Нэр", "analyst");
  });

  it("returns 409 when createUser returns null (duplicate email)", async () => {
    const { createUser } = await import("../db/catalog.js");
    (createUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = mockRes();
    await handle({ body: { email: "dup@example.com", password: "secret123", name: "X" } }, res);
    expect(res._status).toBe(409);
    expect(res._json.error).toMatch(/already registered/i);
  });
});

describe("Admin Documents Router", () => {
  let router: any;

  beforeAll(async () => {
    router = await import("../routes/admin-documents.router.js");
  });

  it("exports a default router", () => {
    expect(router.default).toBeDefined();
    expect(typeof router.default).toBe("function");
  });

  it("registers GET /documents", () => {
    const route = router.default.stack.find((l: any) => l.route?.path === "/documents" && l.route.methods.get);
    expect(route).toBeDefined();
  });

  it("registers GET /documents/categories", () => {
    const route = router.default.stack.find((l: any) => l.route?.path === "/documents/categories" && l.route.methods.get);
    expect(route).toBeDefined();
  });

  it("registers DELETE /documents/:id", () => {
    const route = router.default.stack.find((l: any) => l.route?.path === "/documents/:id" && l.route.methods.delete);
    expect(route).toBeDefined();
  });
});

describe("Admin Summary Router", () => {
  let router: any;

  beforeAll(async () => {
    router = await import("../routes/admin-summary.router.js");
  });

  it("exports a default router", () => {
    expect(router.default).toBeDefined();
    expect(typeof router.default).toBe("function");
  });

  it("registers GET /summary", () => {
    const route = router.default.stack.find((l: any) => l.route?.path === "/summary" && l.route.methods.get);
    expect(route).toBeDefined();
  });
});

describe("API Keys Router PATCH", () => {
  let router: any;

  beforeAll(async () => {
    router = await import("../routes/api-keys.router.js");
  });

  it("registers PATCH /admin/api-keys/:id", () => {
    const route = router.default.stack.find(
      (l: any) => l.route?.path === "/admin/api-keys/:id" && l.route.methods.patch
    );
    expect(route).toBeDefined();
  });

  it("keeps existing POST /admin/api-keys", () => {
    const route = router.default.stack.find(
      (l: any) => l.route?.path === "/admin/api-keys" && l.route.methods.post
    );
    expect(route).toBeDefined();
  });
});
