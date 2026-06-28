import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { initDataLake, isPgAvailable, getPool } from "../db/data-lake.js";
import type { Express } from "express";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@admin.com";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "bataa0818";

describe("Dashboard API endpoints", () => {
    let app: Express;
    let adminToken: string;
    let adminUserId: string;

    beforeAll(async () => {
        await initDataLake();
        if (!isPgAvailable()) return;

        const { app: apiApp } = await import("../api-server.js");
        app = apiApp;

        const adminRes = await request(app)
            .post("/api/auth/login")
            .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
        adminToken = adminRes.body.token;
        adminUserId = adminRes.body.user?.id;

        // Seed a real test table so computeMetrics finds user-owned data
        if (adminUserId) {
            const existing = await getPool().query(
                `SELECT id FROM uploaded_files WHERE type = 'dataset' AND owner_id = $1 LIMIT 1`,
                [adminUserId]
            );
            if (existing.rows.length === 0) {
                await getPool().query(`DROP TABLE IF EXISTS "metrics_test_table"`);
                await getPool().query(`
                    CREATE TABLE "metrics_test_table" (
                        order_date TEXT,
                        sales NUMERIC,
                        quantity NUMERIC,
                        category TEXT,
                        customer_id TEXT
                    )
                `);
                await getPool().query(`
                    INSERT INTO "metrics_test_table" VALUES
                        ('2024-01-15', 1000, 2, 'Technology', 'C001'),
                        ('2024-02-20', 1500, 3, 'Furniture', 'C002'),
                        ('2024-03-10', 800, 1, 'Technology', 'C003')
                `);
                await getPool().query(`
                    INSERT INTO data_lake_catalog (table_name, columns_info, owner_id, visibility, created_at)
                    VALUES ('metrics_test_table', '["order_date","sales","quantity","category","customer_id"]', $1, 'shared', NOW())
                `, [adminUserId]);
                await getPool().query(`
                    INSERT INTO uploaded_files (id, filename, type, description, owner_id, visibility, created_at)
                    VALUES ('metrics_test_table', 'metrics_test_table', 'dataset', 'Test dataset for metrics', $1, 'shared', NOW())
                `, [adminUserId]);
            }
        }
    });

    afterAll(async () => {
        if (isPgAvailable()) {
            await getPool().query(`DROP TABLE IF EXISTS "metrics_test_table" CASCADE`);
            await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = 'metrics_test_table'`);
            await getPool().query(`DELETE FROM uploaded_files WHERE id = 'metrics_test_table'`);
        }
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

        it("returns 400 for unknown metric", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/kpi/nonexistent_metric")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(400);
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
