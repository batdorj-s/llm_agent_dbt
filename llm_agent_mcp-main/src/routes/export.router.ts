import { Router } from "express";
import type express from "express";
import { requireAuth } from "../auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { getActiveCatalogEntry, getPool } from "../db/data-lake.js";

const router = Router();

/** Helper: extract userId from request (set by requireAuth middleware) */
function getUserId(req: express.Request): string {
  return (req as express.Request & { userId: string }).userId || "user-admin-001";
}

/**
 * GET /api/export?table=...&format=csv|json
 * Export dashboard data as CSV or JSON.
 * Defaults to the user's active dataset if no table param is provided.
 */
router.get("/", requireAuth, requirePermission("export:csv"), async (req, res) => {
  try {
    const format = (req.query.format as string) || "csv";

    // Resolve table name: explicit query param > user's active dataset
    let tableName = req.query.table as string | undefined;
    if (!tableName) {
      const entry = await getActiveCatalogEntry(getUserId(req));
      if (!entry) {
        res.status(404).json({ error: "No active dataset found. Upload data first." });
        return;
      }
      tableName = entry.table_name;
    }

    // Fetch data from the resolved table
    const pool = getPool();
    const { rows: data } = await pool.query(`SELECT * FROM "${tableName}" LIMIT 5000`);

    if (!data || data.length === 0) {
      res.status(404).json({ error: "No data found" });
      return;
    }

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${tableName}.json"`);
      res.json({ data, count: data.length, exportedAt: new Date().toISOString() });
      return;
    }

    // CSV format
    const firstRow = data[0] as Record<string, unknown>;
    const headers = Object.keys(firstRow);
    const csvRows = [
      headers.join(","),
      ...data.map((row) => {
        const r = row as Record<string, unknown>;
        return headers
          .map((h) => {
            const val = r[h];
            if (val === null || val === undefined) return "";
            const str = String(val);
            if (str.includes(",") || str.includes("\n") || str.includes('"')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(",");
      }),
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${tableName}.csv"`);
    // BOM for Excel compatibility
    res.send("\uFEFF" + csvRows.join("\n"));
  } catch (error: any) {
    console.error("[Export]", error.message);
    res.status(500).json({ error: error.message || "Export failed" });
  }
});

export default router;
