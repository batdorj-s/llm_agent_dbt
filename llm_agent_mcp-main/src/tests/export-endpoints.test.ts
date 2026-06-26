import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { initDataLake, isPgAvailable } from "../db/data-lake.js";
import type { Express } from "express";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@admin.com";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "bataa0818";

describe("Export endpoints — POST /api/report/export-pdf and export-xlsx", () => {
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

    describe("POST /api/report/export-pdf", () => {
        it("returns 200 with PDF buffer for valid admin token", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/report/export-pdf")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/pdf/);
            expect(Buffer.isBuffer(res.body)).toBe(true);
            expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
        });

        it("returns 401 with no token", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/report/export-pdf");

            expect(res.status).toBe(401);
            expect(res.body.error).toBeTruthy();
        });

        it("returns 401 with invalid token", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/report/export-pdf")
                .set("Authorization", "Bearer definitely.invalid.token");

            expect(res.status).toBe(401);
        });

        it("returns 401 with tampered token", async () => {
            if (!app || !adminToken) return;
            const parts = adminToken.split(".");
            const tampered = `${parts[0]}.${parts[1]}.badsignature`;
            const res = await request(app)
                .post("/api/report/export-pdf")
                .set("Authorization", `Bearer ${tampered}`);

            expect(res.status).toBe(401);
        });
    });

    describe("POST /api/report/export-xlsx", () => {
        it("returns 200 with XLSX buffer for valid admin token", async () => {
            if (!app || !adminToken) return;
            const res = await request(app)
                .post("/api/report/export-xlsx")
                .set("Authorization", `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
            expect(res.text.length).toBeGreaterThan(100);
            expect(res.text.slice(0, 2)).toBe("PK");
        });

        it("returns 401 with no token", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/report/export-xlsx");

            expect(res.status).toBe(401);
        });

        it("returns 401 with invalid token", async () => {
            if (!app) return;
            const res = await request(app)
                .post("/api/report/export-xlsx")
                .set("Authorization", "Bearer invalid.token.here");

            expect(res.status).toBe(401);
        });
    });
});
