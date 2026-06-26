import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { initDataLake, isPgAvailable, getPool } from "../db/data-lake.js";
import { removeDocumentsByPrefix } from "../rag.js";
import type { Express } from "express";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@admin.com";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "bataa0818";
const TEST_TABLE = `test_upload_${Date.now()}`;

describe("Upload endpoints — /api/admin/upload-csv, files, etc.", () => {
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

    afterAll(async () => {
        if (!isPgAvailable()) return;
        try {
            await getPool().query(`DROP TABLE IF EXISTS "${TEST_TABLE}"`);
            await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [TEST_TABLE]);
            await getPool().query(`DELETE FROM uploaded_files WHERE id = $1`, [TEST_TABLE]);
            await removeDocumentsByPrefix(`uploaded_${TEST_TABLE}_`);
            await removeDocumentsByPrefix(`dbt_warning_${TEST_TABLE}`);
        } catch {}
    });

    describe("GET /api/admin/files — listing", () => {
        it("returns 200 with files array for admin token", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/admin/files")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("returns 401 with no token", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/admin/files");
            expect(res.status).toBe(401);
        });
    });

    describe("POST /api/admin/upload-csv", () => {
        it("returns 401 with no token", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/admin/upload-csv")
                .send({ filename: "test.csv", csvContent: "a,b\n1,2", tableName: TEST_TABLE, description: "test" });

            expect(res.status).toBe(401);
        });

        it("returns 400 with missing fields", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/admin/upload-csv")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ filename: "test.csv" });

            expect(res.status).toBe(400);
        });

        it("uploads CSV successfully and creates catalog entry", async () => {
            if (!app || !adminToken) return;

            const csvContent = "date,amount,customer_id\n2024-01-01,100,c1\n2024-02-01,200,c2";
            const res = await request(app)
                .post("/api/admin/upload-csv")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    filename: `${TEST_TABLE}.csv`,
                    csvContent,
                    tableName: TEST_TABLE,
                    description: "Test upload",
                });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("success", true);

            // Verify catalog entry exists
            const catalog = await getPool().query(
                `SELECT table_name FROM data_lake_catalog WHERE table_name = $1`,
                [TEST_TABLE]
            );
            expect(catalog.rows.length).toBeGreaterThanOrEqual(1);

            // Verify uploaded_files entry exists
            const files = await getPool().query(
                `SELECT id FROM uploaded_files WHERE id = $1`,
                [TEST_TABLE]
            );
            expect(files.rows.length).toBeGreaterThanOrEqual(1);
        }, 30000);

        it("lists the newly uploaded file in GET /api/admin/files", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/admin/files")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.some((f: any) => f.id === TEST_TABLE)).toBe(true);
        });
    });

    describe("DELETE /api/admin/files/:id", () => {
        it("returns 401 with no token", async () => {
            if (!app) return;
            const res = await request(app)
                .delete(`/api/admin/files/${TEST_TABLE}`);
            expect(res.status).toBe(401);
        });

        it("deletes uploaded file", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .delete(`/api/admin/files/${TEST_TABLE}`)
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);

            // Verify cleanup
            const files = await getPool().query(
                `SELECT id FROM uploaded_files WHERE id = $1`,
                [TEST_TABLE]
            );
            expect(files.rows.length).toBe(0);
        });
    });
});
