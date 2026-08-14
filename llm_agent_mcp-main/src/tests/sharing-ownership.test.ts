import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { initDataLake, isPgAvailable, getPool } from "../db/data-lake.js";
import type { Express } from "express";

/**
 * C3 regression: sharing/team routes must enforce ownership.
 *   - Team member add/remove: only team creator or team admin
 *   - Share resource / list sharing / revoke: only resource owner or app admin
 */
describe("Sharing ownership controls", () => {
    let app: Express;
    let createToken: (userId: string, role: any) => string;
    let ownerToken: string;
    let intruderToken: string;
    let adminToken: string;

    const ownerId = `owner-test-${Date.now()}`;
    const intruderId = `intruder-test-${Date.now()}`;
    const testTable = `sharing_owner_test_${Date.now()}`;
    let teamId: string | null = null;
    let shareId: string | null = null;

    beforeAll(async () => {
        await initDataLake();
        if (!isPgAvailable()) return;

        const { app: apiApp } = await import("../api-server.js");
        app = apiApp;
        const auth = await import("../auth.js");
        createToken = auth.createToken;
        ownerToken = createToken(ownerId, "analyst");
        intruderToken = createToken(intruderId, "analyst");
        adminToken = createToken("user-admin-001", "admin");

        // Private catalog resource owned by `ownerId`
        await getPool().query(`DROP TABLE IF EXISTS "${testTable}"`);
        await getPool().query(`
            CREATE TABLE "${testTable}" (order_date TEXT, sales NUMERIC)
        `);
        await getPool().query(`
            INSERT INTO data_lake_catalog (table_name, columns_info, owner_id, visibility, created_at)
            VALUES ($1, '["order_date","sales"]', $2, 'private', NOW())
        `, [testTable, ownerId]);
    });

    afterAll(async () => {
        if (isPgAvailable()) {
            if (teamId) {
                await getPool().query(`DELETE FROM team_members WHERE team_id = $1`, [teamId]);
                await getPool().query(`DELETE FROM teams WHERE id = $1`, [teamId]);
            }
            await getPool().query(`DELETE FROM shared_resources WHERE resource_type = 'catalog' AND resource_id = $1`, [testTable]);
            await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [testTable]);
            await getPool().query(`DROP TABLE IF EXISTS "${testTable}" CASCADE`);
        }
    });

    it("owner creates a team", async () => {
        if (!app) return;
        const res = await request(app)
            .post("/api/teams")
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ name: `owner-team-${Date.now()}` });
        expect(res.status).toBe(201);
        teamId = res.body.data.id;
        expect(teamId).toBeTruthy();
    });

    it("non-owner cannot add members to a team (403)", async () => {
        if (!app || !teamId) return;
        const res = await request(app)
            .post(`/api/teams/${teamId}/members`)
            .set("Authorization", `Bearer ${intruderToken}`)
            .send({ user_id: "victim-user", role: "member" });
        expect(res.status).toBe(403);
    });

    it("non-owner cannot remove members from a team (403)", async () => {
        if (!app || !teamId) return;
        const res = await request(app)
            .delete(`/api/teams/${teamId}/members/victim-user`)
            .set("Authorization", `Bearer ${intruderToken}`);
        expect(res.status).toBe(403);
    });

    it("non-owner cannot share a resource they do not own (403)", async () => {
        if (!app) return;
        const res = await request(app)
            .post("/api/sharing")
            .set("Authorization", `Bearer ${intruderToken}`)
            .send({
                resource_type: "catalog",
                resource_id: testTable,
                granted_to_user_id: "victim-user",
                permission: "view",
            });
        expect(res.status).toBe(403);
    });

    it("non-owner cannot list who has access to a resource (403)", async () => {
        if (!app) return;
        const res = await request(app)
            .get(`/api/sharing?type=catalog&id=${testTable}`)
            .set("Authorization", `Bearer ${intruderToken}`);
        expect(res.status).toBe(403);
    });

    it("non-owner cannot revoke an owner's share (403)", async () => {
        if (!app) return;
        const shareRes = await request(app)
            .post("/api/sharing")
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({
                resource_type: "catalog",
                resource_id: testTable,
                granted_to_user_id: "victim-user",
                permission: "view",
            });
        expect(shareRes.status).toBe(201);
        const listRes = await request(app)
            .get(`/api/sharing?type=catalog&id=${testTable}`)
            .set("Authorization", `Bearer ${ownerToken}`);
        expect(listRes.status).toBe(200);
        shareId = listRes.body.data?.[0]?.share_id || null;
        if (!shareId) return;

        const res = await request(app)
            .delete(`/api/sharing/${shareId}`)
            .set("Authorization", `Bearer ${intruderToken}`);
        expect(res.status).toBe(403);
    });

    it("owner can add members to own team (201)", async () => {
        if (!app || !teamId) return;
        const res = await request(app)
            .post(`/api/teams/${teamId}/members`)
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({ user_id: "friend-user", role: "member" });
        expect(res.status).toBe(201);
    });

    it("owner can share own resource (201)", async () => {
        if (!app) return;
        const res = await request(app)
            .post("/api/sharing")
            .set("Authorization", `Bearer ${ownerToken}`)
            .send({
                resource_type: "catalog",
                resource_id: testTable,
                granted_to_user_id: "friend-user",
                permission: "view",
            });
        expect(res.status).toBe(201);
        const listRes = await request(app)
            .get(`/api/sharing?type=catalog&id=${testTable}`)
            .set("Authorization", `Bearer ${ownerToken}`);
        expect(listRes.status).toBe(200);
        shareId = listRes.body.data?.[0]?.share_id || shareId || null;
    });

    it("owner can list sharing of own resource (200)", async () => {
        if (!app) return;
        const res = await request(app)
            .get(`/api/sharing?type=catalog&id=${testTable}`)
            .set("Authorization", `Bearer ${ownerToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("admin can list sharing of any resource (200)", async () => {
        if (!app) return;
        const res = await request(app)
            .get(`/api/sharing?type=catalog&id=${testTable}`)
            .set("Authorization", `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
    });

    it("owner can revoke own share (200)", async () => {
        if (!app || !shareId) return;
        const res = await request(app)
            .delete(`/api/sharing/${shareId}`)
            .set("Authorization", `Bearer ${ownerToken}`);
        expect(res.status).toBe(200);
    });

    it("intruder cannot see owner's team in team list", async () => {
        if (!app || !teamId) return;
        const res = await request(app)
            .get("/api/teams")
            .set("Authorization", `Bearer ${intruderToken}`);
        expect(res.status).toBe(200);
        const ids = (res.body.data || []).map((t: any) => t.id);
        expect(ids).not.toContain(teamId);
    });
});
