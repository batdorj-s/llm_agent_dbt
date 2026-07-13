import { Router } from "express";
import { requireAuth } from "../auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { getUserId, extractDateFilter } from "./shared.js";
import { getRepository } from "../db/kpi-repository.js";
import { getActiveCatalogEntry, getPool } from "../db/data-lake.js";
import { findConceptColumn } from "../agents/columnSynonyms.js";
import { buildMntAmountExpr } from "../utils/sqlHelpers.js";
import { quoteIdent } from "../db/data-lake.js";

const router = Router();

const VALID_METRICS = ["sales", "users", "churn_rate"];

router.get("/kpi/:metric", async (req, res) => {
  const userId = getUserId(req);

  const { metric } = req.params;
  if (!VALID_METRICS.includes(metric)) {
    return res.status(400).json({ error: `Invalid metric '${metric}'. Must be one of: ${VALID_METRICS.join(", ")}` });
  }

  const repo = await getRepository();
  const dateFilter = extractDateFilter(req);

  // Finance table override for "sales" metric
  if (metric === "sales") {
    try {
      const entry = await getActiveCatalogEntry(userId);
      if (entry) {
        const cols: string[] = JSON.parse(entry.columns_info);
        const amtCol = findConceptColumn(cols, "finance_amount", entry.table_name);
        const catCol = findConceptColumn(cols, "finance_category", entry.table_name);
        if (amtCol && catCol) {
          const qAmt = buildMntAmountExpr(quoteIdent(amtCol));
          const qCat = quoteIdent(catCol);
          const qTbl = quoteIdent(entry.table_name);
          const result = await getPool().query(`
            SELECT COALESCE(SUM(${qAmt}), 0) as total
            FROM ${qTbl}
            WHERE ${qCat} ILIKE '%орлого%' AND ${qCat} NOT ILIKE '%зээл%'
          `);
          const current = Math.round(Number(result.rows[0]?.total || 0) * 100) / 100;
          const targetResult = await getPool().query(
            `SELECT target_value, unit FROM kpi_targets WHERE metric_name = $1`, ["sales"]
          );
          const targetRow = targetResult.rows[0] as Record<string, unknown>;
          return res.json({
            name: "sales", current,
            target: targetRow?.target_value ?? 0,
            unit: targetRow?.unit ?? "₮",
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.warn("[KPI] Finance sales override failed:", (err as Error).message);
    }
  }

  try {
    const data = await repo.getKpi(metric as "sales" | "users" | "churn_rate", dateFilter, userId);
    if (!data) return res.status(404).json({ error: `Metric '${metric}' not found` });
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/kpi-history", async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 6;
  const repo = await getRepository();
  const dateFilter = extractDateFilter(req);
  const history = await repo.getSalesHistory(limit, dateFilter, getUserId(req));
  res.json(history);
});

router.get("/kpi/anomalies", requireAuth, requirePermission("kpi:anomaly"), async (req, res) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();
    const entry = await getActiveCatalogEntry(userId);
    if (!entry) return res.json({ anomalies: [], columns: [], totalRows: 0 });

    const tableName = entry.table_name;
    let columnList: string[] = [];
    try { columnList = JSON.parse(entry.columns_info) as string[]; } catch {}

    const numericKeywords = [/age/i, /amount/i, /balance/i, /price/i, /cost/i, /revenue/i, /sales/i,
      /income/i, /profit/i, /spend/i, /value/i, /quantity/i, /count/i, /rate/i, /score/i,
      /total/i, /sum/i, /avg/i, /num/i, /rating/i, /зардал/i, /орлого/i];
    const numericCols = columnList.filter(col => numericKeywords.some(p => p.test(col)));
    if (numericCols.length === 0) return res.json({ anomalies: [], columns: numericCols, totalRows: 0 });

    const limitRows = Number(req.query.limit) || 2000;
    const safeCols = columnList.map(c => `"${c}"`).join(", ");
    const { rows } = await pool.query(`SELECT ${safeCols} FROM "${tableName}" LIMIT $1`, [limitRows]);

    const anomalies: Array<{
      rowIndex: number;
      columnName: string;
      value: number;
      zScore: number;
      method: "z-score" | "iqr";
      row: Record<string, unknown>;
    }> = [];

    for (const col of numericCols) {
      const values = rows.map(r => Number(r[col])).filter(v => !isNaN(v));
      if (values.length < 10) continue;

      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
      if (std === 0) continue;

      const sorted = [...values].sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;
      const iqrLow = q1 - 1.5 * iqr;
      const iqrHigh = q3 + 1.5 * iqr;

      rows.forEach((row, idx) => {
        const val = Number(row[col]);
        if (isNaN(val)) return;
        const z = Math.abs((val - mean) / std);
        const isZAnomaly = z > 3;
        const isIqrAnomaly = val < iqrLow || val > iqrHigh;
        if (isZAnomaly || isIqrAnomaly) {
          anomalies.push({
            rowIndex: idx,
            columnName: col,
            value: val,
            zScore: Math.round(z * 100) / 100,
            method: isZAnomaly ? "z-score" : "iqr",
            row: row as Record<string, unknown>,
          });
        }
      });
    }

    anomalies.sort((a, b) => b.zScore - a.zScore);

    res.json({
      anomalies: anomalies.slice(0, 100),
      columns: numericCols,
      totalRows: rows.length,
      summary: {
        totalAnomalies: anomalies.length,
        byColumn: numericCols.reduce((acc, col) => {
          acc[col] = anomalies.filter(a => a.columnName === col).length;
          return acc;
        }, {} as Record<string, number>),
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/kpi/:metric/target", async (req, res) => {
  const { metric } = req.params;
  if (!VALID_METRICS.includes(metric)) {
    return res.status(400).json({ error: `Invalid metric '${metric}'. Must be one of: ${VALID_METRICS.join(", ")}` });
  }

  const { target } = req.body;
  
  try {
    const repo = await getRepository();
    await repo.updateKpiTarget(metric as "sales" | "users" | "churn_rate", Number(target));
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
