import { Router } from "express";
import crypto from "crypto";
import { getPool } from "../db/pool.js";
import { requirePermission } from "../middleware/rbac.js";
import { log } from "./shared.js";

const router = Router();

const VALID_CHANNELS = ["email", "slack", "telegram"];

router.get("/notifications/preferences", requirePermission("notification:read"), async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const pool = getPool();
    const result = await pool.query(
      "SELECT id, channel, enabled, config, created_at, updated_at FROM notification_preferences WHERE user_id = $1 ORDER BY channel",
      [userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    log("error", "Failed to list notification preferences", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to list notification preferences" });
  }
});

router.post("/notifications/preferences", requirePermission("notification:write"), async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { channel, enabled, config } = req.body;
    if (!channel || !VALID_CHANNELS.includes(channel)) {
      res.status(400).json({ error: `Invalid channel. Valid: ${VALID_CHANNELS.join(", ")}` });
      return;
    }
    const pool = getPool();
    const existing = await pool.query(
      "SELECT id FROM notification_preferences WHERE user_id = $1 AND channel = $2",
      [userId, channel]
    );
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE notification_preferences SET enabled = $1, config = $2, updated_at = NOW() WHERE user_id = $3 AND channel = $4`,
        [enabled !== false, config || {}, userId, channel]
      );
      res.json({ success: true, message: `Notification preference for ${channel} updated` });
    } else {
      const id = `notif_${crypto.randomBytes(8).toString("hex")}`;
      await pool.query(
        `INSERT INTO notification_preferences (id, user_id, channel, enabled, config) VALUES ($1, $2, $3, $4, $5)`,
        [id, userId, channel, enabled !== false, config || {}]
      );
      log("info", `Notification preference created: ${id}`, req as any, { channel });
      res.status(201).json({ success: true, data: { id, channel } });
    }
  } catch (err) {
    log("error", "Failed to create notification preference", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to create notification preference" });
  }
});

router.delete("/notifications/preferences/:channel", requirePermission("notification:write"), async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { channel } = req.params;
    if (!VALID_CHANNELS.includes(channel)) {
      res.status(400).json({ error: `Invalid channel: ${channel}` });
      return;
    }
    const pool = getPool();
    const result = await pool.query(
      "DELETE FROM notification_preferences WHERE user_id = $1 AND channel = $2 RETURNING id",
      [userId, channel]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Notification preference not found" });
      return;
    }
    res.json({ success: true, message: `${channel} notification preference deleted` });
  } catch (err) {
    log("error", "Failed to delete notification preference", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to delete notification preference" });
  }
});

router.post("/notifications/test", requirePermission("notification:write"), async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { channel } = req.body;
    const { sendNotification } = await import("../services/notifications.js");
    await sendNotification(userId, channel || "email", {
      subject: "Test Notification",
      body: `This is a test notification sent at ${new Date().toISOString()}. Your ${channel || "email"} channel is working correctly.`,
    });
    res.json({ success: true, message: `Test ${channel || "notification"} sent` });
  } catch (err) {
    log("error", "Test notification failed", req as any, { error: (err as Error).message });
    res.status(500).json({ error: `Test notification failed: ${(err as Error).message}` });
  }
});

export default router;
