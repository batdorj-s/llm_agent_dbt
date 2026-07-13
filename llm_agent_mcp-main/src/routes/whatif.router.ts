import { Router } from "express";
import { requireAuth } from "../auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { getUserId } from "./shared.js";
import { getActiveCatalogEntry, getPool } from "../db/data-lake.js";

const router = Router();

const NUMERIC_KEYWORDS = [/age/i, /amount/i, /balance/i, /price/i, /cost/i, /revenue/i, /sales/i,
  /income/i, /profit/i, /spend/i, /value/i, /quantity/i, /count/i, /rate/i, /score/i,
  /total/i, /sum/i, /avg/i, /num/i, /rating/i, /зардал/i, /орлого/i];

const CATEGORY_KEYWORDS = [/category/i, /type/i, /status/i, /segment/i, /channel/i, /product/i, /branch/i, /салбар/i, /бүтээгдэхүүн/i];

router.post("/whatif", requireAuth, requirePermission("kpi:whatif"), async (req, res) => {
  try {
    const userId = getUserId(req);
    const { column, changePercent, scenarioName } = req.body;

    if (!column || typeof column !== "string") {
      return res.status(400).json({ error: "column is required" });
    }
    if (changePercent === undefined || typeof changePercent !== "number") {
      return res.status(400).json({ error: "changePercent (number) is required" });
    }
    if (Math.abs(changePercent) > 1000) {
      return res.status(400).json({ error: "changePercent must be between -1000 and 1000" });
    }

    const entry = await getActiveCatalogEntry(userId);
    if (!entry) return res.status(404).json({ error: "No active dataset" });

    const tableName = entry.table_name;
    let columnList: string[] = [];
    try { columnList = JSON.parse(entry.columns_info) as string[]; } catch {}

    if (!columnList.includes(column)) {
      return res.status(400).json({ error: `Column "${column}" not found in dataset` });
    }

    const numericCols = columnList.filter(col => NUMERIC_KEYWORDS.some(p => p.test(col)));
    const targetCols = numericCols.filter(c => c !== column);
    const targetColumn = req.body.targetColumn && targetCols.includes(req.body.targetColumn)
      ? req.body.targetColumn
      : targetCols[0] || column;

    const pool = getPool();
    const safeCols = columnList.map(c => `"${c}"`).join(", ");
    const { rows } = await pool.query(`SELECT ${safeCols} FROM "${tableName}" LIMIT 2000`);

    const baselineValues = rows.map(r => Number(r[targetColumn])).filter(v => !isNaN(v));
    const baselineSum = baselineValues.reduce((a, b) => a + b, 0);
    const baselineMean = baselineValues.length > 0 ? baselineSum / baselineValues.length : 0;

    const sourceValues = rows.map(r => Number(r[column])).filter(v => !isNaN(v));
    const sourceSum = sourceValues.reduce((a, b) => a + b, 0);
    const sourceMean = sourceValues.length > 0 ? sourceSum / sourceValues.length : 0;

    const multiplier = 1 + changePercent / 100;

    const projectedSum = baselineSum * multiplier;
    const projectedMean = baselineMean * multiplier;
    const impact = projectedSum - baselineSum;
    const impactPercent = ((projectedSum - baselineSum) / (baselineSum || 1)) * 100;

    const categoryCol = columnList.find(col => CATEGORY_KEYWORDS.some(p => p.test(col)));

    let categoryImpact: Array<{ category: string; baseline: number; projected: number; change: number }> = [];
    if (categoryCol) {
      const groups = new Map<string, number[]>();
      rows.forEach(r => {
        const cat = String(r[categoryCol] || "Unknown");
        const val = Number(r[targetColumn]);
        if (!isNaN(val)) {
          const existing = groups.get(cat) || [];
          existing.push(val);
          groups.set(cat, existing);
        }
      });
      for (const [cat, vals] of groups) {
        const catSum = vals.reduce((a, b) => a + b, 0);
        categoryImpact.push({
          category: cat,
          baseline: Math.round(catSum * 100) / 100,
          projected: Math.round(catSum * multiplier * 100) / 100,
          change: Math.round((catSum * multiplier - catSum) * 100) / 100,
        });
      }
      categoryImpact.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
      categoryImpact = categoryImpact.slice(0, 10);
    }

    res.json({
      scenario: {
        name: scenarioName || `${column} ${changePercent > 0 ? "+" : ""}${changePercent}%`,
        column,
        changePercent,
        targetColumn,
        rowsAffected: rows.length,
      },
      baseline: {
        columnSum: Math.round(sourceSum * 100) / 100,
        columnMean: Math.round(sourceMean * 100) / 100,
        targetSum: Math.round(baselineSum * 100) / 100,
        targetMean: Math.round(baselineMean * 100) / 100,
      },
      projected: {
        targetSum: Math.round(projectedSum * 100) / 100,
        targetMean: Math.round(projectedMean * 100) / 100,
      },
      impact: {
        absolute: Math.round(impact * 100) / 100,
        percent: Math.round(impactPercent * 100) / 100,
      },
      categoryImpact,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
