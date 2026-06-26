import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { initDataLake, isPgAvailable } from "../db/data-lake.js";
import type { Express } from "express";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@admin.com";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "bataa0818";

describe("Dashboard API endpoints", () => {
    let app: Express;
    let adminToken: string;

    beforeAll(async () => {
        await initDataLake();
        if (!isPgAvailable()) return;

        const { app: apiApp } = await import("../api-server.js");
        app = apiApp;

        const adminRes = await request(app)
            .post("/api/auth/login")
            .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
        adminToken = adminRes.body.token;
    });

    describe("GET /api/kpi/:metric", () => {
        it("returns sales KPI for admin token", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/kpi/sales")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("name", "sales");
            expect(res.body).toHaveProperty("current");
            expect(typeof res.body.current).toBe("number");
        });

        it("returns users KPI", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/kpi/users")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("name", "users");
        });

        it("returns churn_rate KPI", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/kpi/churn_rate")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("name", "churn_rate");
        });

        it("returns 404 for unknown metric", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/kpi/nonexistent_metric")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(404);
        });

        it("returns 401 with no token", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/kpi/sales");

            expect(res.status).toBe(401);
        });
    });

    describe("GET /api/kpi-history", () => {
        it("returns sales history array for admin token", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/kpi-history")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            if (res.body.length > 0) {
                expect(res.body[0]).toHaveProperty("month");
                expect(res.body[0]).toHaveProperty("revenue");
            }
        });

        it("respects limit query param", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/kpi-history?limit=3")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.length).toBeLessThanOrEqual(3);
        });

        it("returns 401 with no token", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/kpi-history");

            expect(res.status).toBe(401);
        });
    });

    describe("GET /api/dashboard/computed-metrics", () => {
        it("returns computed metrics for admin token", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/dashboard/computed-metrics")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("aov");
            expect(res.body).toHaveProperty("growthRate");
            expect(res.body).toHaveProperty("topCategory");
        });

        it("returns 401 with no token", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/dashboard/computed-metrics");

            expect(res.status).toBe(401);
        });
    });
});
