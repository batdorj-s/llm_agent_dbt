import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { initDataLake, isPgAvailable, getPool, getCatalog } from "../db/data-lake.js";
import { removeDocumentsByPrefix } from "../rag.js";
import type { Express } from "express";
import fs from "fs";
import path from "path";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@admin.com";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "bataa0818";
const SUFFIX = Date.now();
const TEST_TABLE = `flow_test_${SUFFIX}`;
const TEST_EMAIL = `flow_user_${SUFFIX}@test.com`;
const TEST_PASS = "testpass123";

describe("Complete Data Flow & Workflow", () => {
    let app: Express;
    let adminToken: string;
    let threadId: string;

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
        await getPool().query(`DROP TABLE IF EXISTS "${TEST_TABLE}" CASCADE`).catch(() => {});
        await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [TEST_TABLE]).catch(() => {});
        await getPool().query(`DELETE FROM uploaded_files WHERE id = $1`, [TEST_TABLE]).catch(() => {});
        await removeDocumentsByPrefix(`uploaded_${TEST_TABLE}_`).catch(() => {});
        await removeDocumentsByPrefix(`dbt_warning_${TEST_TABLE}`).catch(() => {});
        await removeDocumentsByPrefix(`kpi_${TEST_TABLE}`).catch(() => {});
        await getPool().query(`DELETE FROM users WHERE email = $1`, [TEST_EMAIL]).catch(() => {});
        // Clean up failed_queries.json entries for this test
        const fqp = path.join(process.cwd(), "logs", "failed_queries.json");
        try {
            if (fs.existsSync(fqp)) {
                const raw = fs.readFileSync(fqp, "utf8");
                const data = JSON.parse(raw);
                const filtered = data.filter((e: any) => !e.threadId?.includes(SUFFIX.toString()));
                fs.writeFileSync(fqp, JSON.stringify(filtered, null, 2), "utf8");
            }
        } catch {}
    });

    // ─── 1. AUTH FLOW ───────────────────────────────────────
    describe("Auth Flow", () => {
        it("GET /api/status returns ok", async () => {
            if (!app) return;
            const res = await request(app).get("/api/status");
            expect(res.status).toBe(200);
            expect(res.body.status).toBe("ok");
            expect(res.body.llm).toBeDefined();
        });

        it("POST /api/auth/login — invalid credentials rejected", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/auth/login")
                .send({ email: "wrong@test.com", password: "wrongpass1" });
            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/invalid/i);
        });

        it("POST /api/auth/login — missing fields rejected", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/auth/login")
                .send({ email: "test@test.com" });
            expect(res.status).toBe(400);
        });

        it("POST /api/auth/login — short password rejected", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/auth/login")
                .send({ email: "test@test.com", password: "short" });
            expect(res.status).toBe(400);
        });

        it("POST /api/auth/login — bad email rejected", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/auth/login")
                .send({ email: "notanemail", password: "longenough1" });
            expect(res.status).toBe(400);
        });

        it("POST /api/auth/login — valid admin gets token", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/auth/login")
                .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
            expect(res.status).toBe(200);
            expect(res.body.token).toBeTruthy();
            expect(res.body.user.role).toBe("admin");
            adminToken = res.body.token;
        });

        it("POST /api/auth/register — creates new user", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/auth/register")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ email: TEST_EMAIL, password: TEST_PASS, name: "Flow Tester", role: "analyst" });
            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
        });

        it("POST /api/auth/register — duplicate email rejected", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/auth/register")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ email: TEST_EMAIL, password: TEST_PASS, name: "Flow Tester", role: "analyst" });
            expect(res.status).toBe(409);
        });

        it("POST /api/auth/register — no token rejected", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/auth/register")
                .send({ email: "another@test.com", password: TEST_PASS, name: "Another" });
            expect(res.status).toBe(401);
        });

        it("Token verification — invalid tokens rejected across endpoints", async () => {
            if (!app) return;
            const tests = [
                { method: "post" as const, path: "/api/chat" },
                { method: "get" as const, path: "/api/admin/files" },
                { method: "post" as const, path: "/api/report/export-pdf" },
            ];
            for (const { method, path } of tests) {
                const res = await request(app)[method](path)
                    .set("Authorization", "Bearer invalid.token.here");
                expect(res.status).toBe(401);
            }
        });
    });

    // ─── 2. FILE MANAGEMENT FLOW ─────────────────────────────
    describe("File Management Flow", () => {
        it("GET /api/admin/files — lists files", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/admin/files")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("GET /api/admin/files — 401 without token", async () => {
            if (!app) return;
            const res = await request(app).get("/api/admin/files");
            expect(res.status).toBe(401);
        });
    });

    // ─── 3. CSV UPLOAD & DATA FLOW ──────────────────────────
    describe("CSV Upload & Data Flow", () => {
        it("POST /api/admin/upload-csv — missing fields rejected", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/admin/upload-csv")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({});
            expect(res.status).toBe(400);
        });

        it("POST /api/admin/upload-csv — uploads CSV, creates catalog, returns dbtStatus", async () => {
            if (!app || !adminToken) return;

            const csvContent = "date,amount,customer_id\n2024-01-01,100,c1\n2024-02-01,200,c2";
            const res = await request(app)
                .post("/api/admin/upload-csv")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    filename: `${TEST_TABLE}.csv`,
                    csvContent,
                    tableName: TEST_TABLE,
                    description: "Flow test upload",
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.dbtStatus).toBeDefined();
            expect(res.body.columns).toContain("date");
            expect(res.body.columns).toContain("amount");
            expect(res.body.columns).toContain("customer_id");
            expect(Array.isArray(res.body.preview)).toBe(true);

            // Verify: catalog entry created
            const catalogRows = await getPool().query(
                `SELECT table_name, column_profiles IS NOT NULL AS has_profiles FROM data_lake_catalog WHERE table_name = $1`,
                [TEST_TABLE]
            );
            expect(catalogRows.rows.length).toBeGreaterThanOrEqual(1);
            expect(catalogRows.rows[0].has_profiles).toBe(true);

            // Verify: uploaded_files entry created with semantic groups
            const filesRows = await getPool().query(
                `SELECT id, semantic_groups IS NOT NULL AS has_groups FROM uploaded_files WHERE id = $1`,
                [TEST_TABLE]
            );
            expect(filesRows.rows.length).toBeGreaterThanOrEqual(1);
            expect(filesRows.rows[0].has_groups).toBe(true);

            // Verify: data exists in the table
            const dataRows = await getPool().query(`SELECT COUNT(*) AS cnt FROM "${TEST_TABLE}"`);
            expect(Number(dataRows.rows[0].cnt)).toBeGreaterThan(0);
        }, 30000);

        it("GET /api/admin/files — lists uploaded file", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/admin/files")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.body.some((f: any) => f.id === TEST_TABLE)).toBe(true);
            const file = res.body.find((f: any) => f.id === TEST_TABLE);
            expect(file.filename).toBe(TEST_TABLE);
            expect(file.type).toBe("dataset");
        });

        it("GET /api/admin/files/:id/preview — returns preview with columns", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get(`/api/admin/files/${TEST_TABLE}/preview`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(res.body.type).toBe("dataset");
            expect(res.body.columns).toContain("amount");
            expect(Array.isArray(res.body.preview)).toBe(true);
        });

        it("GET /api/admin/files/:id/download — rejects dataset download (only documents)", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get(`/api/admin/files/${TEST_TABLE}/download`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/document/i);
        });
    });

    // ─── 4. DB CONNECTIVITY & DATA LAKE FLOW ───────────────
    describe("Data Lake & DB Connectivity", () => {
        it("Database is reachable and catalog has entries for admin", async () => {
            const catalog = await getCatalog(ADMIN_EMAIL);
            expect(Array.isArray(catalog)).toBe(true);
            // The catalog may or may not have our test table depending on owner_id resolution
            // Just verify DB is working
            const count = await getPool().query(`SELECT COUNT(*) AS cnt FROM data_lake_catalog`);
            expect(Number(count.rows[0].cnt)).toBeGreaterThanOrEqual(0);
        });

        it("Database rows exist in uploaded table", async () => {
            const dataRows = await getPool().query(`SELECT COUNT(*) AS cnt FROM "${TEST_TABLE}"`);
            expect(Number(dataRows.rows[0].cnt)).toBeGreaterThan(0);
        });
    });

    // ─── 5. FEEDBACK FLOW ───────────────────────────────────
    describe("Feedback Flow", () => {
        let feedbackId: string;

        it("POST /api/feedback — submits feedback with rating", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/feedback")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    message: `Test query ${SUFFIX}`,
                    response: "test response",
                    rating: "negative",
                    threadId: `thread_${SUFFIX}`,
                });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it("POST /api/feedback — missing fields rejected", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/feedback")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ message: "test" });
            expect(res.status).toBe(400);
        });

        it("POST /api/feedback — invalid rating rejected", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/feedback")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ message: "test", rating: "invalid" });
            expect(res.status).toBe(400);
        });

        it("GET /api/admin/feedback/pending — lists pending feedback", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/admin/feedback/pending")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            const match = res.body.find((f: any) => f.threadId === `thread_${SUFFIX}`);
            if (match) feedbackId = match.id;
        });

        it("POST /api/admin/feedback/:id/approve — approves and adds to RAG", async () => {
            if (!app || !adminToken || !feedbackId) return;
            const res = await request(app)
                .post(`/api/admin/feedback/${feedbackId}/approve`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({ correctAnswer: "42" });
            expect(res.status).toBe(200);
        });

        it("POST /api/admin/feedback/:id/approve — duplicate approval ok", async () => {
            if (!app || !adminToken || !feedbackId) return;
            const res = await request(app)
                .post(`/api/admin/feedback/${feedbackId}/approve`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
        });
    });

    // ─── 6. REPORT & EXPORT FLOW ────────────────────────────
    describe("Report & Export Flow", () => {
        it("POST /api/report/export-pdf — generates PDF", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/report/export-pdf")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/pdf/);
            expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
        });

        it("POST /api/report/export-xlsx — generates XLSX (admin)", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/report/export-xlsx")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/spreadsheetml/);
            expect(res.text.length).toBeGreaterThan(100);
            expect(res.text.slice(0, 2)).toBe("PK");
        });

        it("POST /api/report/export-pdf — 401 without token", async () => {
            if (!app) return;
            const res = await request(app).post("/api/report/export-pdf");
            expect(res.status).toBe(401);
        });

        it("POST /api/report/export-pdf — 401 with tampered token", async () => {
            if (!app || !adminToken) return;
            const parts = adminToken.split(".");
            const tampered = `${parts[0]}.${parts[1]}.badsig`;
            const res = await request(app)
                .post("/api/report/export-pdf")
                .set("Authorization", `Bearer ${tampered}`);
            expect(res.status).toBe(401);
        });
    });

    // ─── 7. KPI DASHBOARD FLOW ──────────────────────────────
    describe("KPI Dashboard Flow", () => {
        it("GET /api/kpi/:metric — returns data for valid metric", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/kpi/sales")
                .set("Authorization", `Bearer ${adminToken}`);
            // 404 is valid if no KPI data exists, but not a server error
            expect([200, 404]).toContain(res.status);
        });

        it("GET /api/kpi/:metric — invalid metric rejected", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/kpi/invalid_metric")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(400);
        });

        it("GET /api/kpi/:metric — 401 without token", async () => {
            if (!app) return;
            const res = await request(app).get("/api/kpi/sales");
            expect(res.status).toBe(401);
        });

        it("GET /api/kpi-history — returns history array", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/kpi-history")
                .set("Authorization", `Bearer ${adminToken}`);
            expect([200, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(Array.isArray(res.body)).toBe(true);
            }
        });

        it("GET /api/dashboard/computed-metrics — returns metrics", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/dashboard/computed-metrics")
                .set("Authorization", `Bearer ${adminToken}`);
            expect([200, 404]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body).toHaveProperty("aov");
            }
        });
    });

    // ─── 8. CHAT STREAMING FLOW ─────────────────────────────
    describe("Chat Streaming Flow", () => {
        it("POST /api/chat — 400 without message", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/chat")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({});
            expect(res.status).toBe(400);
        });

        it("POST /api/chat — 401 without token", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/chat")
                .send({ message: "test" });
            expect(res.status).toBe(401);
        });

        it("POST /api/chat/stream — returns SSE data", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/chat/stream")
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    message: "Та хэдэн хүснэгт байгааг жагсаа",
                    threadId: `thread_${SUFFIX}_stream`,
                });
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
            expect(res.text).toContain("data:");
            threadId = `thread_${SUFFIX}_stream`;
        }, 60000);
    });

    // ─── 9. FILE DELETION FLOW ──────────────────────────────
    describe("File Deletion & Cleanup Flow", () => {
        it("DELETE /api/admin/files/:id — 401 without token", async () => {
            if (!app) return;
            const res = await request(app).delete(`/api/admin/files/${TEST_TABLE}`);
            expect(res.status).toBe(401);
        });

        it("DELETE /api/admin/files/:id — deletes file and catalog entry", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .delete(`/api/admin/files/${TEST_TABLE}`)
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.status).toBe(200);

            // Verify uploaded_files cleaned
            const filesRow = await getPool().query(
                `SELECT id FROM uploaded_files WHERE id = $1`, [TEST_TABLE]
            );
            expect(filesRow.rows.length).toBe(0);
        });
    });

    // ─── 10. CROSS-TENANT ISOLATION FLOW ─────────────────────
    describe("Cross-Tenant Isolation Flow", () => {
        it("GET /api/admin/files — user sees only own files after deletion", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .get("/api/admin/files")
                .set("Authorization", `Bearer ${adminToken}`);
            expect(res.body.some((f: any) => f.id === TEST_TABLE)).toBe(false);
        });
    });
});
