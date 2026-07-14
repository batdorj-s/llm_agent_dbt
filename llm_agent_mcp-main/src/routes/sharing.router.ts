/**
 * sharing.router.ts — Collaboration & Sharing API
 *
 * Teams:
 *   GET    /api/teams              → List teams
 *   POST   /api/teams              → Create team
 *   POST   /api/teams/:id/members  → Add member
 *   DELETE /api/teams/:id/members/:userId → Remove member
 *
 * Sharing:
 *   POST   /api/sharing          → Share a resource with user/team
 *   GET    /api/sharing?type=&id= → Who has access to a resource
 *   DELETE /api/sharing/:shareId → Revoke access
 *   GET    /api/shared-with-me   → Resources shared with current user
 */

import { Router } from "express";
import crypto from "crypto";
import { getPool } from "../db/pool.js";
import { log } from "./shared.js";

const router = Router();

// ── Helpers ─────────────────────────────────────────────

function getUserId(req: any): string {
  return req.user?.userId || req.apiKeyInfo?.user_id || "unknown";
}

// ── Teams ───────────────────────────────────────────────

router.get("/teams", async (req, res) => {
  try {
    const pool = getPool();
    const userId = getUserId(req);

    const result = await pool.query(
      `SELECT t.id, t.name, t.description, t.created_by, t.created_at,
              (SELECT COUNT(*) FROM team_members WHERE team_id = t.id)::int AS member_count
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = $1 OR t.created_by = $1
       GROUP BY t.id
       ORDER BY t.name`,
      [userId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    log("error", "Failed to list teams", {} as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to list teams" });
  }
});

router.post("/teams", async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const id = `team_${crypto.randomBytes(6).toString("hex")}`;
    const userId = getUserId(req);
    const pool = getPool();

    await pool.query(
      "INSERT INTO teams (id, name, description, created_by) VALUES ($1, $2, $3, $4)",
      [id, name, description || "", userId]
    );
    await pool.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'admin')",
      [id, userId]
    );

    log("info", `Team created: ${id}`, req as any, { name });
    res.status(201).json({ success: true, data: { id, name } });
  } catch (err) {
    log("error", "Failed to create team", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to create team" });
  }
});

router.post("/teams/:id/members", async (req, res) => {
  try {
    const { user_id, role } = req.body;
    if (!user_id) {
      res.status(400).json({ error: "user_id is required" });
      return;
    }

    const pool = getPool();
    await pool.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [req.params.id, user_id, role || "member"]
    );

    res.status(201).json({ success: true, message: "Member added" });
  } catch (err) {
    log("error", "Failed to add team member", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to add team member" });
  }
});

router.delete("/teams/:id/members/:userId", async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(
      "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2",
      [req.params.id, req.params.userId]
    );
    res.json({ success: true, message: "Member removed" });
  } catch (err) {
    log("error", "Failed to remove team member", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to remove team member" });
  }
});

// ── Sharing ────────────────────────────────────────────

router.post("/sharing", async (req, res) => {
  try {
    const { resource_type, resource_id, granted_to_user_id, granted_to_team_id, permission } = req.body;

    if (!resource_type || !resource_id) {
      res.status(400).json({ error: "resource_type and resource_id are required" });
      return;
    }

    if (!granted_to_user_id && !granted_to_team_id) {
      res.status(400).json({ error: "Either granted_to_user_id or granted_to_team_id is required" });
      return;
    }

    const pool = getPool();
    const userId = getUserId(req);

    await pool.query(
      `INSERT INTO shared_resources (resource_type, resource_id, granted_to_user_id, granted_to_team_id, permission, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (resource_type, resource_id, granted_to_user_id, granted_to_team_id)
       DO UPDATE SET permission = $5`,
      [resource_type, resource_id, granted_to_user_id || null, granted_to_team_id || null, permission || "view", userId]
    );

    log("info", `Resource shared: ${resource_type}/${resource_id}`, req as any, { granted_to_user_id, granted_to_team_id });

    res.status(201).json({ success: true, message: "Resource shared" });
  } catch (err) {
    log("error", "Failed to share resource", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to share resource" });
  }
});

router.get("/sharing", async (req, res) => {
  try {
    const { type, id } = req.query;

    if (!type || !id) {
      res.status(400).json({ error: "type and id query params are required" });
      return;
    }

    const pool = getPool();
    const result = await pool.query(
      `SELECT sr.id AS share_id, sr.resource_type, sr.resource_id,
              sr.granted_to_user_id, sr.granted_to_team_id,
              sr.permission, sr.granted_by, sr.created_at
       FROM shared_resources sr
       WHERE sr.resource_type = $1 AND sr.resource_id = $2
       ORDER BY sr.created_at DESC`,
      [type, id]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    log("error", "Failed to list sharing", {} as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to list sharing" });
  }
});

router.delete("/sharing/:shareId", async (req, res) => {
  try {
    const pool = getPool();
    await pool.query("DELETE FROM shared_resources WHERE id = $1", [req.params.shareId]);
    res.json({ success: true, message: "Access revoked" });
  } catch (err) {
    log("error", "Failed to revoke access", {} as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to revoke access" });
  }
});

router.get("/shared-with-me", async (req, res) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();

    // Resources shared with user directly or through teams
    const result = await pool.query(
      `SELECT sr.id AS share_id, sr.resource_type, sr.resource_id, sr.permission, sr.granted_by, sr.created_at
       FROM shared_resources sr
       WHERE sr.granted_to_user_id = $1
          OR sr.granted_to_team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
       ORDER BY sr.created_at DESC`,
      [userId]
    );

    // Fetch resource names
    const resources = [];
    for (const row of result.rows) {
      let name = row.resource_id;
      if (row.resource_type === "catalog") {
        const cat = await pool.query("SELECT table_name FROM data_lake_catalog WHERE table_name = $1", [row.resource_id]);
        name = cat.rows[0]?.table_name || row.resource_id;
      }
      resources.push({ ...row, name });
    }

    res.json({ success: true, data: resources });
  } catch (err) {
    log("error", "Failed to list shared resources", {} as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to list shared resources" });
  }
});

// ── Enhanced access check (replaces simple catalog check) ──

export async function canAccessResource(
  pool: any,
  resourceType: string,
  resourceId: string,
  userId: string,
  minPermission: string = "view"
): Promise<boolean> {
  // Check ownership
  let ownerId: string | null = null;
  if (resourceType === "catalog") {
    const result = await pool.query(
      "SELECT owner_id, visibility FROM data_lake_catalog WHERE table_name = $1",
      [resourceId]
    );
    if (result.rows.length === 0) return false;
    const row = result.rows[0];
    if (row.visibility === "shared") return true;
    ownerId = row.owner_id;
  }

  // Owner always has access
  if (ownerId && ownerId === userId) return true;

  // Check shared_resources
  const shareResult = await pool.query(
    `SELECT 1 FROM shared_resources
     WHERE resource_type = $1 AND resource_id = $2
       AND permission >= $3
       AND (granted_to_user_id = $4
            OR granted_to_team_id IN (SELECT team_id FROM team_members WHERE user_id = $4))
     LIMIT 1`,
    [resourceType, resourceId, minPermission, userId]
  );

  return shareResult.rows.length > 0;
}

export default router;
