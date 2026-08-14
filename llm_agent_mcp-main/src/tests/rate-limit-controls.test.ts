import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { initDataLake, isPgAvailable, getPool } from "../db/data-lake.js";
import type { Express } from "express";

/**
 * C5 regression: expensive endpoints must have dedicated rate limits.
 *   GET  /api/export              → exportLimiter (5/min)
 *   POST /api/export-pdf          → exportLimiter (5/min)
 *   POST /api/export-xlsx         → exportLimiter (5/min)
 *   POST /api/admin/analysis/sql  → sqlLimiter (10/min)
 *   POST /api/whatif              → whatifLimiter (10/min)
 */
describe("Expensive endpoint rate limits", () => {
    let app: Express;
    let createToken: (userId: string, role: any) => string;
    let exportToken: string;
    let pdfToken: string;
    let xlsxToken: string;
    let sqlToken: string;
    let whatifToken: string;

    const testTable = `ratelimit_test_${Date.now()}`;
    const suffix = Date.now();

    beforeAll(async () => {
        await initDataLake();
        if (!isPgAvailable()) return;

        const { app: apiApp } = await import("../api-server.js");
        app = apiApp;
        const auth = await import("../auth.js");
        createToken = auth.createToken;
        exportToken = createToken(`export-user-${suffix}`, "analyst");
        pdfToken = createToken(`pdf-user-${suffix}`, "analyst");
        xlsxToken = createToken(`xlsx-user-${suffix}`, "analyst");
        sqlToken = createToken(`sql-admin-${suffix}`, "admin");
        whatifToken = createToken(`whatif-user-${suffix}`, "analyst");

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
            VALUES ($1, $1, 'dataset', 'Test dataset for rate limits', 'user-admin-001', 'shared', NOW())
        `, [testTable]);
    });

    afterAll(async () => {
        if (isPgAvailable()) {
            await getPool().query(`DROP TABLE IF EXISTS "${testTable}" CASCADE`);
            await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [testTable]);
            await getPool().query(`DELETE FROM uploaded_files WHERE id = $1`, [testTable]);
        }
    });

    it("GET /api/export allows first requests then 429 on the 6th", async () => {
        if (!app) return;
        for (let i = 0; i < 5; i++) {
            const res = await request(app)
                .get(`/api/export?table=${testTable}&format=csv`)
                .set("Authorization", `Bearer ${exportToken}`);
            expect(res.status).not.toBe(429);
        }
        const res6 = await request(app)
            .get(`/api/export?table=${testTable}&format=csv`)
            .set("Authorization", `Bearer ${exportToken}`);
        expect(res6.status).toBe(429);
    });

    it("POST /api/export-pdf allows first requests then 429 on the 6th", async () => {
        if (!app) return;
        for (let i = 0; i < 5; i++) {
            const res = await request(app)
                .post("/api/export-pdf")
                .set("Authorization", `Bearer ${pdfToken}`);
            expect(res.status).not.toBe(429);
        }
        const res6 = await request(app)
            .post("/api/export-pdf")
            .set("Authorization", `Bearer ${pdfToken}`);
        expect(res6.status).toBe(429);
    });

    it("POST /api/export-xlsx allows first requests then 429 on the 6th", async () => {
        if (!app) return;
        for (let i = 0; i < 5; i++) {
            const res = await request(app)
                .post("/api/export-xlsx")
                .set("Authorization", `Bearer ${xlsxToken}`);
            expect(res.status).not.toBe(429);
        }
        const res6 = await request(app)
            .post("/api/export-xlsx")
            .set("Authorization", `Bearer ${xlsxToken}`);
        expect(res6.status).toBe(429);
    });

    it("POST /api/admin/analysis/sql allows first requests then 429 on the 11th", async () => {
        if (!app) return;
        for (let i = 0; i < 10; i++) {
            const res = await request(app)
                .post("/api/admin/analysis/sql")
                .set("Authorization", `Bearer ${sqlToken}`)
                .send({ query: `SELECT 1` });
            expect(res.status).not.toBe(429);
        }
        const res11 = await request(app)
            .post("/api/admin/analysis/sql")
            .set("Authorization", `Bearer ${sqlToken}`)
            .send({ query: `SELECT 1` });
        expect(res11.status).toBe(429);
    });

    it("POST /api/whatif allows first requests then 429 on the 11th", async () => {
        if (!app) return;
        for (let i = 0; i < 10; i++) {
            const res = await request(app)
                .post("/api/whatif")
                .set("Authorization", `Bearer ${whatifToken}`)
                .send({ column: "sales", changePercent: 10 });
            expect(res.status).not.toBe(429);
        }
        const res11 = await request(app)
            .post("/api/whatif")
            .set("Authorization", `Bearer ${whatifToken}`)
            .send({ column: "sales", changePercent: 10 });
        expect(res11.status).toBe(429);
    });
});
