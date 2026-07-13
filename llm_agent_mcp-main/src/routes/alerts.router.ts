import { Router } from "express";
import { requireAuth } from "../auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { getUserId } from "./shared.js";
import { scanAlerts } from "../services/alerts.js";

const router = Router();

router.get("/alerts", requireAuth, requirePermission("alert:read"), async (req, res) => {
  try {
    const alerts = await scanAlerts(getUserId(req));
    res.json({ success: true, data: alerts, count: alerts.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Alert scan failed" });
  }
});

export default router;
