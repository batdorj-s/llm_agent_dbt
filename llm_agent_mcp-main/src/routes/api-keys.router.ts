/**
 * api-keys.router.ts — API Key Management
 *
 * POST   /api/admin/api-keys        → Generate a new API key
 * GET    /api/admin/api-keys         → List keys (prefix + name, never full key)
 * DELETE /api/admin/api-keys/:id     → Revoke an API key
 *
 * requireApiKey middleware for external API access.
 */

import { Router } from "express";
import crypto from "crypto";
import { getPool } from "../db/pool.js";
import { requirePermission } from "../middleware/rbac.js";
import { log } from "./shared.js";

const router = Router();

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const prefix = crypto.randomBytes(4).toString("hex");
  const random = crypto.randomBytes(24).toString("hex");
  const key = `sk_${prefix}_${random}`;
  return { key, keyHash: hashApiKey(key), keyPrefix: prefix };
}

/**
 * requireApiKey — Express middleware for API key authentication.
 * Checks X-API-Key header against the api_keys table.
 * Usage: app.use("/api/external", requireApiKey, handler);
 */
export async function requireApiKey(req: any, res: any, next: any): Promise<void> {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || typeof apiKey !== "string") {
    res.status(401).json({ error: "API key required (X-API-Key header)" });
    return;
  }

  try {
    const pool = getPool();
    const keyHash = hashApiKey(apiKey);

    const result = await pool.query(
      `SELECT id, user_id, name, permissions, expires_at, is_active
       FROM api_keys
       WHERE key_hash = $1 AND is_active = true`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: "Invalid or inactive API key" });
      return;
    }

    const keyRow = result.rows[0];

    if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
      res.status(401).json({ error: "API key expired" });
      return;
    }

    // Update last_used_at (fire-and-forget)
    pool.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [keyRow.id]).catch(() => {});

    // Attach key info to request
    req.apiKeyInfo = keyRow;
    req.user = { userId: keyRow.user_id, role: "admin" };

    next();
  } catch (err) {
    log("error", "API key validation failed", {} as any, { error: (err as Error).message });
    res.status(500).json({ error: "API key validation failed" });
  }
}

// ── CRUD Routes ─────────────────────────────────────────

/** Generate a new API key */
router.post("/admin/api-keys", requirePermission("admin:users"), async (req, res) => {
  try {
    const { name, permissions, expiresInDays } = req.body;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const userId = (req as any).user?.userId || "unknown";
    const { key, keyHash, keyPrefix } = generateApiKey();
    const id = `apikey_${crypto.randomBytes(8).toString("hex")}`;

    const pool = getPool();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
      : null;

    await pool.query(
      `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, permissions, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, userId, keyHash, keyPrefix, name, permissions || [], expiresAt]
    );

    log("info", `API key created: ${id}`, req as any, { keyPrefix, name });

    res.status(201).json({
      success: true,
      data: {
        id,
        name,
        key, // Shown only once at creation
        keyPrefix,
        expiresAt,
      },
    });
  } catch (err) {
    log("error", "Failed to create API key", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to create API key" });
  }
});

/** List all API keys (never return full key) */
router.get("/admin/api-keys", requirePermission("admin:users"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, key_prefix, name, permissions, expires_at, is_active, last_used_at, created_at
       FROM api_keys
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      data: result.rows.map((row: any) => ({
        id: row.id,
        keyPrefix: row.key_prefix,
        name: row.name,
        permissions: row.permissions,
        expiresAt: row.expires_at,
        isActive: row.is_active,
        lastUsedAt: row.last_used_at,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    log("error", "Failed to list API keys", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to list API keys" });
  }
});

/** Revoke an API key */
router.delete("/admin/api-keys/:id", requirePermission("admin:users"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `UPDATE api_keys SET is_active = false WHERE id = $1 RETURNING id`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "API key not found" });
      return;
    }

    log("info", `API key revoked: ${req.params.id}`, req as any, {});

    res.json({ success: true, message: "API key revoked" });
  } catch (err) {
    log("error", "Failed to revoke API key", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to revoke API key" });
  }
});

export default router;
