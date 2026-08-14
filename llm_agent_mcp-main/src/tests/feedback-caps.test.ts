import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/pool.js", () => ({
  getPool: vi.fn(),
}));

vi.mock("../db/data-lake.js", () => ({
  getPool: vi.fn(),
}));

import { getPool } from "../db/pool.js";
import feedbackRouter from "../routes/feedback.router.js";

const mockedPool = { query: vi.fn() };
(getPool as ReturnType<typeof vi.fn>).mockReturnValue(mockedPool);

function makeReq(body: any) {
  return { body, userId: "user-1", user: { userId: "user-1", role: "analyst" } } as any;
}

function makeRes() {
  const res: any = { statusCode: 200, body: null };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  return res;
}

describe("Feedback Router — message caps", () => {
  beforeEach(() => {
    mockedPool.query.mockReset();
    mockedPool.query.mockResolvedValue({
      rows: [{
        id: "feedback_1",
        user_id: "user-1",
        message: "hello",
        response: "",
        rating: "positive",
        status: "approved",
        thread_id: null,
        created_at: new Date("2026-01-01T00:00:00Z"),
      }],
    });
  });

  function handler() {
    const stack = (feedbackRouter as any).stack;
    const route = stack.find((l: any) => l.route?.path === "/");
    return route.route.stack[0].handle;
  }

  it("accepts a valid feedback message", async () => {
    const res = makeRes();
    await handler()(makeReq({ message: "Great answer", rating: "positive" }), res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockedPool.query).toHaveBeenCalledTimes(1);
  });

  it("rejects missing message with 400", async () => {
    const res = makeRes();
    await handler()(makeReq({ rating: "positive" }), res, () => {});
    expect(res.statusCode).toBe(400);
    expect(mockedPool.query).not.toHaveBeenCalled();
  });

  it("rejects message over 4000 characters with 400", async () => {
    const res = makeRes();
    await handler()(makeReq({ message: "x".repeat(4001), rating: "positive" }), res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/4000/);
  });

  it("rejects non-string message with 400", async () => {
    const res = makeRes();
    await handler()(makeReq({ message: 12345, rating: "positive" }), res, () => {});
    expect(res.statusCode).toBe(400);
  });

  it("rejects response over 10000 characters with 400", async () => {
    const res = makeRes();
    await handler()(makeReq({ message: "ok", response: "y".repeat(10001), rating: "negative" }), res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/10000/);
  });

  it("rejects invalid rating with 400", async () => {
    const res = makeRes();
    await handler()(makeReq({ message: "ok", rating: "meh" }), res, () => {});
    expect(res.statusCode).toBe(400);
  });

  it("trims whitespace around message", async () => {
    const res = makeRes();
    await handler()(makeReq({ message: "  hello  ", rating: "positive" }), res, () => {});
    expect(res.statusCode).toBe(200);
    const params = mockedPool.query.mock.calls[0][1];
    expect(params[2]).toBe("hello");
  });
});