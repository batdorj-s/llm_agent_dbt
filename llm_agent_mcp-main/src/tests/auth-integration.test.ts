import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { initDataLake, isPgAvailable, createUser } from "../db/data-lake.js";
import type { Express } from "express";

describe("Auth Integration — Real Login → Protected Endpoint", () => {
    const suffix = Date.now();
    const adminEmail = `rbac_int_admin_${suffix}@test.com`;
    const viewerEmail = `rbac_int_viewer_${suffix}@test.com`;
    const password = "IntTestPass123!";

    let app: Express;
    let adminToken: string;
    let viewerToken: string;

    beforeAll(async () => {
        await initDataLake();
        if (!isPgAvailable()) return;

        await createUser(adminEmail, password, "RBAC Admin", "admin");
        await createUser(viewerEmail, password, "RBAC Viewer", "viewer");

        const { app: apiApp } = await import("../api-server.js");
        app = apiApp;

        // Authenticate once — all tests reuse these tokens
        const adminRes = await request(app)
            .post("/api/auth/login")
            .send({ email: adminEmail, password });
        adminToken = adminRes.body.token;

        const viewerRes = await request(app)
            .post("/api/auth/login")
            .send({ email: viewerEmail, password });
        viewerToken = viewerRes.body.token;
    });

    afterAll(async () => {
        if (!isPgAvailable()) return;
        const { getPool } = await import("../db/data-lake.js");
        await getPool().query("DELETE FROM users WHERE email LIKE $1", [`rbac_int_%`]);
    });

    describe("POST /api/auth/login", () => {
        it("returns real JWT for valid admin credentials", () => {
            if (!app) return;
            expect(adminToken).toBeTruthy();
            expect(adminToken.split(".").length).toBe(3);
        });

        it("returns 401 for wrong password", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/auth/login")
                .send({ email: adminEmail, password: "wrong-password" });
            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/invalid/i);
        });

        it("returns 401 for wrong email", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/auth/login")
                .send({ email: "nonexistent@test.com", password });
            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/invalid/i);
        });

        it("returns 400 for missing fields", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/auth/login")
                .send({ email: adminEmail });
            expect(res.status).toBe(400);
        });
    });

    describe("Protected endpoint — GET /api/admin/feedback/pending", () => {
        it("admin token → 200", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/admin/feedback/pending")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("viewer token → 403 (Admins only)", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/admin/feedback/pending")
                .set("Authorization", `Bearer ${viewerToken}`);
            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/admin/i);
        });

        it("no token → 401", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/admin/feedback/pending");
            expect(res.status).toBe(401);
        });

        it("invalid token → 401", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/admin/feedback/pending")
                .set("Authorization", "Bearer definitely.invalid.token");
            expect(res.status).toBe(401);
        });

        it("tampered token → 401", async () => {
            if (!app || !adminToken) return;
            const parts = adminToken.split(".");
            const tampered = `${parts[0]}.${parts[1]}.badsignature`;
            const res = await request(app)
                .get("/api/admin/feedback/pending")
                .set("Authorization", `Bearer ${tampered}`);
            expect(res.status).toBe(401);
        });
    });
});
