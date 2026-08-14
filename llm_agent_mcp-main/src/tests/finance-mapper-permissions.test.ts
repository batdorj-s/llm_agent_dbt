import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type express from "express";

/**
 * C2 regression: finance-mapper spawns Python subprocesses and must be
 * restricted to authenticated admins with an explicit rate limit.
 */
describe("finance-mapper authorization", () => {
  let app: express.Express;
  let createToken: (userId: string, role: any) => string;
  let viewerToken: string;
  let adminToken: string;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "test-secret-please-change-0123456789abcdef";
    delete process.env.ALLOW_DEV_AUTH;
    vi.resetModules();

    const auth = await import("../auth.js");
    createToken = auth.createToken;
    viewerToken = createToken("viewer-user-1", "viewer");
    adminToken = createToken("admin-user-1", "admin");

    const { default: expressMod } = await import("express");
    const { default: financeMapperRouter } = await import("../routes/finance-mapper.router.js");
    // Router already applies requireAuth internally; mounting it here too
    // would add a second env-sensitive import and race other files that
    // mutate process.env concurrently in the same worker process.
    app = expressMod();
    app.use(expressMod.json());
    app.use("/api", financeMapperRouter);
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects anonymous upload with 401", async () => {
    const res = await request(app).post("/api/finance-mapper/upload");
    expect(res.status).toBe(401);
  });

  it("rejects anonymous document mapping with 401", async () => {
    const res = await request(app).post("/api/finance-mapper/document");
    expect(res.status).toBe(401);
  });

  it("rejects anonymous text mapping with 401", async () => {
    const res = await request(app).post("/api/finance-mapper/text").send({ text: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects anonymous download with 401", async () => {
    const res = await request(app).get("/api/finance-mapper/download/sar_test.xlsx");
    expect(res.status).toBe(401);
  });

  it("rejects viewer upload with 403", async () => {
    const res = await request(app)
      .post("/api/finance-mapper/upload")
      .set("Authorization", `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it("rejects viewer text mapping with 403", async () => {
    const res = await request(app)
      .post("/api/finance-mapper/text")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ text: "x" });
    expect(res.status).toBe(403);
  });

  it("rejects viewer download with 403", async () => {
    const res = await request(app)
      .get("/api/finance-mapper/download/sar_test.xlsx")
      .set("Authorization", `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it("allows admin to reach upload handler (400 = passed auth, missing file)", async () => {
    const res = await request(app)
      .post("/api/finance-mapper/upload")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it("allows admin to reach download handler (400 = invalid filename, passed auth)", async () => {
    const res = await request(app)
      .get("/api/finance-mapper/download/not-sar.txt")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});
