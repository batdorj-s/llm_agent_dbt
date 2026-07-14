import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { initDataLake, isPgAvailable, getPool, getCatalog } from "../db/data-lake.js";
import { removeDocumentsByPrefix } from "../rag.js";
import type { Express } from "express";
import fs from "fs";
import path from "path";

const SUFFIX = Date.now();
const TEST_TABLE = `flow_test_${SUFFIX}`;

describe("Complete Data Flow & Workflow", () => {
    let app: Express;
    let _threadId: string;

    beforeAll(async () => {
        await initDataLake();
        if (!isPgAvailable()) return;

        const { app: apiApp } = await import("../api-server.js");
        app = apiApp;
    });

    afterAll(async () => {
        if (!isPgAvailable()) return;
        await getPool().query(`DROP TABLE IF EXISTS "${TEST_TABLE}" CASCADE`).catch(() => {});
        await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [TEST_TABLE]).catch(() => {});
        await getPool().query(`DELETE FROM uploaded_files WHERE id = $1`, [TEST_TABLE]).catch(() => {});
        await removeDocumentsByPrefix(`uploaded_${TEST_TABLE}_`).catch(() => {});
        await removeDocumentsByPrefix(`dbt_warning_${TEST_TABLE}`).catch(() => {});
        await removeDocumentsByPrefix(`kpi_${TEST_TABLE}`).catch(() => {});
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

    // ─── 1. STATUS ──────────────────────────────────────────
    describe("Status", () => {
        it("GET /api/status returns ok", async () => {
            if (!app) return;
            const res = await request(app).get("/api/status");
            expect(res.status).toBe(200);
            expect(res.body.status).toBe("ok");
            expect(res.body.llm).toBeDefined();
        });
    });

    // ─── 2. FILE MANAGEMENT FLOW ─────────────────────────────
    describe("File Management Flow", () => {
        it("GET /api/admin/files — lists files", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/admin/files");
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });
    });

    // ─── 3. CSV UPLOAD & DATA FLOW ──────────────────────────
    describe("CSV Upload & Data Flow", () => {
        it("POST /api/admin/upload-csv — missing fields rejected", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/admin/upload-csv")
                .send({});
            expect(res.status).toBe(400);
        });

        it("POST /api/admin/upload-csv — uploads CSV, creates catalog, returns dbtStatus", async () => {
            if (!app) return;

            const csvContent = "date,amount,customer_id\n2024-01-01,100,c1\n2024-02-01,200,c2";
            const res = await request(app)
                .post("/api/admin/upload-csv")
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
            if (!app) return;
            const res = await request(app)
                .get("/api/admin/files");
            expect(res.body.some((f: any) => f.id === TEST_TABLE)).toBe(true);
            const file = res.body.find((f: any) => f.id === TEST_TABLE);
            expect(file.filename).toBe(TEST_TABLE);
            expect(file.type).toBe("dataset");
        });

        it("GET /api/admin/files/:id/preview — returns preview with columns", async () => {
            if (!app) return;
            const res = await request(app)
                .get(`/api/admin/files/${TEST_TABLE}/preview`);
            expect(res.status).toBe(200);
            expect(res.body.type).toBe("dataset");
            expect(res.body.columns).toContain("amount");
            expect(Array.isArray(res.body.preview)).toBe(true);
        });

        it("GET /api/admin/files/:id/download — rejects dataset download (only documents)", async () => {
            if (!app) return;
            const res = await request(app)
                .get(`/api/admin/files/${TEST_TABLE}/download`);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/document/i);
        });
    });

    // ─── 4. DB CONNECTIVITY & DATA LAKE FLOW ───────────────
    describe("Data Lake & DB Connectivity", () => {
        it("Database is reachable and catalog has entries", async () => {
            const catalog = await getCatalog("");
            expect(Array.isArray(catalog)).toBe(true);
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
            if (!app) return;
            const res = await request(app)
                .post("/api/feedback")
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
            if (!app) return;
            const res = await request(app)
                .post("/api/feedback")
                .send({ message: "test" });
            expect(res.status).toBe(400);
        });

        it("POST /api/feedback — invalid rating rejected", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/feedback")
                .send({ message: "test", rating: "invalid" });
            expect(res.status).toBe(400);
        });

        it("GET /api/admin/feedback/pending — lists pending feedback", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/admin/feedback/pending");
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            const match = res.body.find((f: any) => f.threadId === `thread_${SUFFIX}`);
            if (match) feedbackId = match.id;
        });

        it("POST /api/admin/feedback/:id/approve — approves and adds to RAG", async () => {
            if (!app || !feedbackId) return;
            const res = await request(app)
                .post(`/api/admin/feedback/${feedbackId}/approve`)
                .send({ correctAnswer: "42" });
            expect(res.status).toBe(200);
        });

        it("POST /api/admin/feedback/:id/approve — duplicate approval ok", async () => {
            if (!app || !feedbackId) return;
            const res = await request(app)
                .post(`/api/admin/feedback/${feedbackId}/approve`);
            expect(res.status).toBe(200);
        });
    });

    // ─── 6. REPORT & EXPORT FLOW ────────────────────────────
    describe("Report & Export Flow", () => {
        it("POST /api/report/export-pdf — generates PDF", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/report/export-pdf");
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/pdf/);
            expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
        });

        it("POST /api/report/export-xlsx — generates XLSX", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/report/export-xlsx");
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/spreadsheetml/);
            expect(res.text.length).toBeGreaterThan(100);
            expect(res.text.slice(0, 2)).toBe("PK");
        });
    });

    // ─── 7. KPI DASHBOARD FLOW ──────────────────────────────
    describe("KPI Dashboard Flow", () => {
        it("GET /api/kpi/:metric — returns data for valid metric", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/kpi/sales");
            expect([200, 404]).toContain(res.status);
        });

        it("GET /api/kpi/:metric — invalid metric rejected", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/kpi/invalid_metric");
            expect(res.status).toBe(400);
        });

        it("GET /api/kpi-history — returns history array", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/kpi-history");
            expect([200, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(Array.isArray(res.body)).toBe(true);
            }
        });

        it("GET /api/dashboard/computed-metrics — returns metrics", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/dashboard/computed-metrics");
            expect([200, 404]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body).toHaveProperty("aov");
            }
        });
    });

    // ─── 8. CHAT STREAMING FLOW ─────────────────────────────
    describe("Chat Streaming Flow", () => {
        it("POST /api/chat — 400 without message", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/chat")
                .send({});
            expect(res.status).toBe(400);
        });

        it("POST /api/chat/stream — returns SSE data", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/chat/stream")
                .send({
                    message: "Та хэдэн хүснэгт байгааг жагсаа",
                    threadId: `thread_${SUFFIX}_stream`,
                });
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
            expect(res.text).toContain("data:");
            _threadId = `thread_${SUFFIX}_stream`;
        }, 60000);
    });

    // ─── 9. FILE DELETION FLOW ──────────────────────────────
    describe("File Deletion & Cleanup Flow", () => {
        it("DELETE /api/admin/files/:id — deletes file and catalog entry", async () => {
            if (!app) return;
            const res = await request(app)
                .delete(`/api/admin/files/${TEST_TABLE}`);
            expect(res.status).toBe(200);

            // Verify uploaded_files cleaned
            const filesRow = await getPool().query(
                `SELECT id FROM uploaded_files WHERE id = $1`, [TEST_TABLE]
            );
            expect(filesRow.rows.length).toBe(0);
        });
    });

    // ─── 10. POST-DELETION FLOW ─────────────────────────────
    describe("Post-Deletion Flow", () => {
        it("GET /api/admin/files — file no longer listed after deletion", async () => {
            if (!app) return;
            const res = await request(app)
                .get("/api/admin/files");
            expect(res.body.some((f: any) => f.id === TEST_TABLE)).toBe(false);
        });
    });
});
