import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("../auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "u1", role: "analyst" };
    next();
  },
}));

vi.mock("../middleware/rbac.js", () => ({
  requirePermission: (_perm: string) => (_req: any, _res: any, next: any) => next(),
}));

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

describe("metrics.router", () => {
  let metricsRouter: any;
  let handle: any;

  beforeAll(async () => {
    metricsRouter = await import("../routes/metrics.router.js");
    handle = findHandler(metricsRouter, "get", "/");
  });

  it("returns metrics loaded from docs/dbt-metrics.yaml", async () => {
    const res = mockRes();
    await handle({}, res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(res._json.count).toBe(res._json.data.length);
    if (res._json.count > 0) {
      expect(res._json.data[0]).toHaveProperty("name");
    }
  });
});
