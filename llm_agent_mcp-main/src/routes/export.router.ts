import { Router } from "express";
import { requireAuth } from "../auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { getRawData } from "../services/sql.js";

const router = Router();

/**
 * GET /api/export?table=...&format=csv|json
 * Export dashboard data as CSV or JSON
 */
router.get("/", requireAuth, requirePermission("export:csv"), async (req, res) => {
  try {
    const tableName = (req.query.table as string) || "raw_data";
    const format = (req.query.format as string) || "csv";

    // Fetch raw table data
    const data = await getRawData(tableName, 5000);

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
