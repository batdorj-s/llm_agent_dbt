import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { initDataLake, isPgAvailable, getPool } from "../db/data-lake.js";
import type { Express } from "express";

const SUFFIX = Date.now();
const TEST_TABLE = `export_test_${SUFFIX}`;

describe("Export endpoints — POST /api/report/export-pdf and export-xlsx", () => {
    let app: Express;

    beforeAll(async () => {
        await initDataLake();
        if (!isPgAvailable()) return;

        const { app: apiApp } = await import("../api-server.js");
        app = apiApp;

        // Set up test data for export
        await getPool().query(
            `CREATE TABLE IF NOT EXISTS "${TEST_TABLE}" (id INT, amount NUMERIC, quantity INT, category TEXT, date TEXT)`
        );
        await getPool().query(
            `INSERT INTO "${TEST_TABLE}" (id, amount, quantity, category, date) VALUES
             (1, 500000, 2, 'Operating Expense', '2024-06-01'),
             (2, 300000, 1, 'Rent Expense', '2024-06-15'),
             (3, 1000000, 1, 'Sales Income', '2024-06-20')`
        );
        await getPool().query(
            `INSERT INTO data_lake_catalog
             (table_name, created_by, owner_id, visibility, columns_info, description)
             VALUES ($1, NULL, NULL, 'shared', '["id","amount","quantity","category","date"]', 'export test data')
             ON CONFLICT (table_name) DO UPDATE SET
               visibility = EXCLUDED.visibility,
               columns_info = EXCLUDED.columns_info`,
            [TEST_TABLE]
        );
        await getPool().query(
            `INSERT INTO uploaded_files (id, filename, type, description, owner_id, visibility, created_at)
             VALUES ($1, $1, 'dataset', 'export test data', NULL, 'shared', NOW())
             ON CONFLICT (id) DO UPDATE SET
               visibility = EXCLUDED.visibility`,
            [TEST_TABLE]
        );
    });

    afterAll(async () => {
        if (!isPgAvailable()) return;
        await getPool().query(`DROP TABLE IF EXISTS "${TEST_TABLE}" CASCADE`).catch(() => {});
        await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [TEST_TABLE]).catch(() => {});
        await getPool().query(`DELETE FROM uploaded_files WHERE id = $1`, [TEST_TABLE]).catch(() => {});
    });

    describe("POST /api/report/export-pdf", () => {
        it("returns 200 with PDF buffer", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/report/export-pdf");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/pdf/);
            expect(Buffer.isBuffer(res.body)).toBe(true);
            expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
        });
    });

    describe("POST /api/report/export-xlsx", () => {
        it("returns 200 with XLSX buffer", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/report/export-xlsx");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
            expect(res.text.length).toBeGreaterThan(100);
            expect(res.text.slice(0, 2)).toBe("PK");
        });
    });
});
