import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { initDataLake, isPgAvailable, getPool } from "../db/data-lake.js";
import type { Express } from "express";

/**
 * C4 regression: report export endpoints must require analyst+ permission.
 *   POST /api/export-pdf, POST /api/export-xlsx  → export:csv (analyst+)
 * Finance read routes must be explicitly gated to dashboard readers.
 */
describe("Export permission controls", () => {
    let app: Express;
    let createToken: (userId: string, role: any) => string;
    let viewerToken: string;
    let analystToken: string;
    let adminToken: string;

    const testTable = `export_perm_test_${Date.now()}`;

    beforeAll(async () => {
        await initDataLake();
        if (!isPgAvailable()) return;

        const { app: apiApp } = await import("../api-server.js");
        app = apiApp;
        const auth = await import("../auth.js");
        createToken = auth.createToken;
        viewerToken = createToken(`viewer-export-${Date.now()}`, "viewer");
        analystToken = createToken(`analyst-export-${Date.now()}`, "analyst");
        adminToken = createToken("user-admin-001", "admin");

        // Seed a catalog entry so export/report endpoints can run
        await getPool().query(`DROP TABLE IF EXISTS "${testTable}"`);
        await getPool().query(`
            CREATE TABLE "${testTable}" (order_date TEXT, sales NUMERIC, quantity NUMERIC, category TEXT, customer_id TEXT)
        `);
        await getPool().query(`
            INSERT INTO "${testTable}" VALUES
                ('2024-01-15', 1000, 2, 'Technology', 'C001'),
                ('2024-02-20', 1500, 3, 'Furniture', 'C002'),
                ('2024-03-10', 800, 1, 'Technology', 'C003')
        `);
        await getPool().query(`
            INSERT INTO data_lake_catalog (table_name, columns_info, owner_id, visibility, created_at)
            VALUES ($1, '["order_date","sales","quantity","category","customer_id"]', 'user-admin-001', 'shared', NOW())
        `, [testTable]);
        await getPool().query(`
            INSERT INTO uploaded_files (id, filename, type, description, owner_id, visibility, created_at)
            VALUES ($1, $1, 'dataset', 'Test dataset for exports', 'user-admin-001', 'shared', NOW())
        `, [testTable]);
    });

    afterAll(async () => {
        if (isPgAvailable()) {
            await getPool().query(`DROP TABLE IF EXISTS "${testTable}" CASCADE`);
            await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [testTable]);
            await getPool().query(`DELETE FROM uploaded_files WHERE id = $1`, [testTable]);
        }
    });

    it("viewer cannot export PDF report (403)", async () => {
        if (!app) return;
        const res = await request(app)
            .post("/api/export-pdf")
            .set("Authorization", `Bearer ${viewerToken}`);
        expect(res.status).toBe(403);
    });

    it("viewer cannot export XLSX report (403)", async () => {
        if (!app) return;
        const res = await request(app)
            .post("/api/export-xlsx")
            .set("Authorization", `Bearer ${viewerToken}`);
        expect(res.status).toBe(403);
    });

    it("invalid token cannot export PDF report (401)", async () => {
        if (!app) return;
        process.env.ALLOW_DEV_AUTH = "";
        try {
            const res = await request(app)
                .post("/api/export-pdf")
                .set("Authorization", "Bearer invalid.token.here");
            expect(res.status).toBe(401);
        } finally {
            process.env.ALLOW_DEV_AUTH = "true";
        }
    });

    it("analyst can export PDF report (not 401/403)", async () => {
        if (!app) return;
        const res = await request(app)
            .post("/api/export-pdf")
            .set("Authorization", `Bearer ${analystToken}`);
        expect([200, 404, 500]).toContain(res.status);
    });

    it("analyst can export XLSX report (not 401/403)", async () => {
        if (!app) return;
        const res = await request(app)
            .post("/api/export-xlsx")
            .set("Authorization", `Bearer ${analystToken}`);
        expect([200, 404, 500]).toContain(res.status);
    });

    it("admin can export PDF report (not 401/403)", async () => {
        if (!app) return;
        const res = await request(app)
            .post("/api/export-pdf")
            .set("Authorization", `Bearer ${adminToken}`);
        expect([200, 404, 500]).toContain(res.status);
    });

    it("viewer can read finance charts (dashboard:read, 200)", async () => {
        if (!app) return;
        const res = await request(app)
            .get("/api/finance-charts")
            .set("Authorization", `Bearer ${viewerToken}`);
        expect(res.status).toBe(200);
    });

    it("viewer can read computed metrics (not 401/403 — metrics:read is viewer-level)", async () => {
        if (!app) return;
        const res = await request(app)
            .get("/api/computed-metrics")
            .set("Authorization", `Bearer ${viewerToken}`);
        expect([200, 404]).toContain(res.status);
    });

    it("dataset owner (admin) reads computed metrics (200)", async () => {
        if (!app) return;
        const res = await request(app)
            .get("/api/computed-metrics")
            .set("Authorization", `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
    });
});
