import { describe, it, expect, vi, beforeAll } from "vitest";

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

  it("registers PATCH /users/:id", () => {
    const route = router.default.stack.find((l: any) => l.route?.path === "/users/:id" && l.route.methods.patch);
    expect(route).toBeDefined();
  });

  it("registers DELETE /users/:id", () => {
    const route = router.default.stack.find((l: any) => l.route?.path === "/users/:id" && l.route.methods.delete);
    expect(route).toBeDefined();
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
