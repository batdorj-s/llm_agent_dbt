import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { initDataLake, isPgAvailable, getPool } from "../db/data-lake.js";
import type { Express } from "express";

describe("Dashboard API endpoints", () => {
    let app: Express;
    const testTable = `metrics_test_table_${Date.now()}`;

    beforeAll(async () => {
        await initDataLake();
        if (!isPgAvailable()) return;

        const { app: apiApp } = await import("../api-server.js");
        app = apiApp;

        // Seed a real test table so computeMetrics finds data
        await getPool().query(`DROP TABLE IF EXISTS "${testTable}"`);
        await getPool().query(`
            CREATE TABLE "${testTable}" (
                order_date TEXT,
                sales NUMERIC,
                quantity NUMERIC,
                category TEXT,
                customer_id TEXT
            )
        `);
        await getPool().query(`
            INSERT INTO "${testTable}" VALUES
                ('2024-01-15', 1000, 2, 'Technology', 'C001'),
                ('2024-02-20', 1500, 3, 'Furniture', 'C002'),
                ('2024-03-10', 800, 1, 'Technology', 'C003')
        `);
        await getPool().query(`
            INSERT INTO data_lake_catalog (table_name, columns_info, owner_id, visibility, created_at)
            VALUES ($1, '["order_date","sales","quantity","category","customer_id"]', NULL, 'shared', NOW())
        `, [testTable]);
        await getPool().query(`
            INSERT INTO uploaded_files (id, filename, type, description, owner_id, visibility, created_at)
            VALUES ($1, $1, 'dataset', 'Test dataset for metrics', NULL, 'shared', NOW())
        `, [testTable]);
    });

    afterAll(async () => {
        if (isPgAvailable()) {
            await getPool().query(`DROP TABLE IF EXISTS "${testTable}" CASCADE`);
            await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [testTable]);
            await getPool().query(`DELETE FROM uploaded_files WHERE id = $1`, [testTable]);
        }
    });

    describe("GET /api/kpi/:metric", () => {
        it("returns sales KPI", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/kpi/sales");

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("name", "sales");
            expect(res.body).toHaveProperty("current");
            expect(typeof res.body.current).toBe("number");
        });

        it("returns users KPI", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/kpi/users");

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("name", "users");
        });

        it("returns churn_rate KPI", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/kpi/churn_rate");

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("name", "churn_rate");
        });

        it("returns 400 for unknown metric", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/kpi/nonexistent_metric");

            expect(res.status).toBe(400);
        });
    });

    describe("GET /api/kpi-history", () => {
        it("returns sales history array", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/kpi-history");

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            if (res.body.length > 0) {
                expect(res.body[0]).toHaveProperty("month");
                expect(res.body[0]).toHaveProperty("revenue");
            }
        });

        it("respects limit query param", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/kpi-history?limit=3");

            expect(res.status).toBe(200);
            expect(res.body.length).toBeLessThanOrEqual(3);
        });
    });

    describe("GET /api/dashboard/computed-metrics", () => {
        it("returns computed metrics", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/dashboard/computed-metrics");

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("aov");
            expect(res.body).toHaveProperty("growthRate");
            expect(res.body).toHaveProperty("topCategory");
        });
    });
});
