import { Router } from "express";
import { getUserId } from "./shared.js";
import { getActiveCatalogEntry, getPool } from "../db/data-lake.js";
import { findConceptColumn } from "../agents/columnSynonyms.js";
import { buildMntAmountExpr } from "../utils/sqlHelpers.js";
import { quoteIdent } from "../db/data-lake.js";
import { buildNoiseSubcategoryFilter } from "../db/data-lake.js";
import { getPassportByTableName, parsePassportQuestions } from "../rag.js";

const router = Router();

// ─────────────────────────────────────────────────────────────
// Finance Default Charts
// ─────────────────────────────────────────────────────────────
router.get("/finance-charts", async (req, res) => {
  const userId = getUserId(req);
  const pool = getPool();

  try {
    const entry = await getActiveCatalogEntry(userId);
    if (!entry) return res.json({ isFinance: false });

    const columns: string[] = JSON.parse(entry.columns_info);
    const table = entry.table_name;

    const amtCol    = findConceptColumn(columns, "finance_amount",      table);
    const catCol    = findConceptColumn(columns, "finance_category",    table);
    const subCatCol = findConceptColumn(columns, "finance_subcategory", table);
    const dateCol   = findConceptColumn(columns, "finance_date",        table);
    const partyCol  = findConceptColumn(columns, "finance_party",       table);

    if (!amtCol || !catCol) return res.json({ isFinance: false });

    const qAmt    = buildMntAmountExpr(quoteIdent(amtCol));
    const qCat    = quoteIdent(catCol);
    const qSubCat = subCatCol ? quoteIdent(subCatCol) : null;
    const qTbl    = quoteIdent(table);

    const isOpIncome  = `(${qCat} ILIKE '%орлого%' AND ${qCat} NOT ILIKE '%зээл%')`;
    const isOpExpense = qSubCat
      ? `(${qCat} ILIKE '%зарлага%' AND ${qSubCat} NOT ILIKE '%зээл%' AND ${buildNoiseSubcategoryFilter(qSubCat)})`
      : `${qCat} ILIKE '%зарлага%'`;
    const notNoise = `${qCat} NOT ILIKE '%шилжүүлэг%' AND ${qCat} NOT ILIKE '%эздийн зээл%'`;
    const validDate = dateCol ? `(${quoteIdent(dateCol)} IS NOT NULL AND ${quoteIdent(dateCol)}::text != '')` : null;

    const charts: Array<{ id: string; title: string; type?: string; data: Array<Record<string, unknown>>; config?: Record<string, unknown> }> = [];

    function formatMonthLabel(yyyyMM: string): string {
      const m = parseInt((yyyyMM || "").split("-")[1] || "1", 10);
      return `${m}-р сар`;
    }

    // 1. Category breakdown
    try {
      const groupCol = qSubCat ?? qCat;
      const r = await pool.query(`
        SELECT ${groupCol} AS label, SUM(${qAmt}) AS value
        FROM ${qTbl}
        WHERE ${isOpExpense} AND ${groupCol} IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 7
      `);
      if (r.rows.length > 0) {
        charts.push({
          id: "category_breakdown",
          title: "Зарлагын бүтэц (үйл ажиллагааны)",
          type: "donut",
          data: r.rows.map((row: Record<string, unknown>) => ({ label: String(row.label ?? ""), value: Number(row.value ?? 0) })),
          config: { xAxis: "label", yAxis: "value" },
        });
      }
    } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }

    // 2. Monthly cashflow
    if (dateCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const r = await pool.query(`
          SELECT
            TO_CHAR(${qDate}::DATE, 'YYYY-MM') AS label,
            SUM(CASE WHEN ${isOpIncome}  THEN ${qAmt} ELSE 0 END) AS "Орлого",
            SUM(CASE WHEN ${isOpExpense} THEN ${qAmt} ELSE 0 END) AS "Зарлага"
          FROM ${qTbl}
          WHERE ${validDate} AND ${notNoise}
          GROUP BY 1 ORDER BY 1
        `);
        if (r.rows.length > 0) {
          charts.push({
            id: "monthly_cashflow",
            title: "Сарын орлого / зарлага",
            type: "bar",
            data: r.rows.map((row: Record<string, unknown>) => ({
              label: formatMonthLabel(String(row.label ?? "")),
              "Орлого": Number(row["Орлого"] ?? 0),
              "Зарлага": Number(row["Зарлага"] ?? 0),
            })),
            config: { xAxis: "label", yAxis: "value", series: ["Орлого", "Зарлага"], stacked: false },
          });
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // 3. Income sources by counterparty
    if (partyCol) {
      try {
        const qParty = quoteIdent(partyCol);
        const r = await pool.query(`
          SELECT ${qParty} AS label, SUM(${qAmt}) AS value
          FROM ${qTbl}
          WHERE ${isOpIncome} AND ${qParty} IS NOT NULL AND ${qParty} != ''
          GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 10
        `);
        if (r.rows.length > 0) {
          charts.push({
            id: "top_parties",
            title: "Орлогын эх үүсвэр (харилцагчаар)",
            type: "horizontal_bar",
            data: r.rows.map((row: Record<string, unknown>) => ({ label: String(row.label ?? ""), value: Number(row.value ?? 0) })),
            config: { xAxis: "label", yAxis: "value" },
          });
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // 4. Daily net cashflow
    if (dateCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const r = await pool.query(`
          SELECT
            TO_CHAR(${qDate}::DATE, 'MM/DD') AS label,
            SUM(CASE WHEN ${isOpIncome}  THEN ${qAmt} ELSE 0 END) -
            SUM(CASE WHEN ${isOpExpense} THEN ${qAmt} ELSE 0 END) AS value
          FROM ${qTbl}
          WHERE ${validDate} AND ${notNoise}
          GROUP BY 1, ${qDate}::DATE ORDER BY ${qDate}::DATE
        `);
        if (r.rows.length > 0) {
          charts.push({
            id: "daily_trend",
            title: "Өдрийн цэвэр орлого",
            type: "line",
            data: r.rows.map((row: Record<string, unknown>) => ({ label: String(row.label ?? ""), value: Number(row.value ?? 0) })),
            config: { xAxis: "label", yAxis: "value" },
          });
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // 5. Monthly operating profit/loss
    if (dateCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const r = await pool.query(`
          SELECT
            TO_CHAR(${qDate}::DATE, 'YYYY-MM') AS label,
            SUM(CASE WHEN ${isOpIncome}  THEN ${qAmt} ELSE 0 END) -
            SUM(CASE WHEN ${isOpExpense} THEN ${qAmt} ELSE 0 END) AS value
          FROM ${qTbl}
          WHERE ${validDate} AND ${notNoise}
          GROUP BY 1 ORDER BY 1
        `);
        if (r.rows.length > 0) {
          charts.push({
            id: "monthly_profit",
            title: "Сарын үйл ажиллагааны ашиг/алдагдал",
            type: "bar",
            data: r.rows.map((row: Record<string, unknown>) => ({
              label: formatMonthLabel(String(row.label ?? "")),
              value: Number(row.value ?? 0),
            })),
            config: { xAxis: "label", yAxis: "value" },
          });
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // 6. Monthly expense breakdown by subcategory (stacked bar)
    if (dateCol && subCatCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const qSub  = quoteIdent(subCatCol);
        const r = await pool.query(`
          SELECT
            TO_CHAR(${qDate}::DATE, 'YYYY-MM') AS month,
            ${qSub} AS subcat,
            SUM(${qAmt}) AS total
          FROM ${qTbl}
          WHERE ${isOpExpense} AND ${qSub} IS NOT NULL AND ${validDate}
          GROUP BY 1, 2
          ORDER BY 1
        `);
        if (r.rows.length > 0) {
          const subcatTotals: Record<string, number> = {};
          for (const row of r.rows as Record<string, unknown>[]) {
            const s = String(row.subcat ?? "");
            subcatTotals[s] = (subcatTotals[s] || 0) + Number(row.total ?? 0);
          }
          const topSubcats = Object.entries(subcatTotals)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([k]) => k);

          const monthMap: Record<string, Record<string, number>> = {};
          for (const row of r.rows as Record<string, unknown>[]) {
            const m = String(row.month ?? "");
            const s = String(row.subcat ?? "");
            if (!topSubcats.includes(s)) continue;
            if (!monthMap[m]) monthMap[m] = {};
            monthMap[m][s] = Number(row.total ?? 0);
          }

          const pivotData = Object.entries(monthMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, vals]) => {
              const entry: Record<string, string | number> = { label: formatMonthLabel(month) };
              for (const s of topSubcats) {
                entry[s] = vals[s] || 0;
              }
              return entry;
            });

          charts.push({
            id: "expense_breakdown_monthly",
            title: "Зарлагын бүтэц сараар",
            type: "stacked_bar",
            data: pivotData,
            config: { xAxis: "label", yAxis: "value", series: topSubcats, stacked: true },
          });
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // 7. Cashflow summary
    if (dateCol && subCatCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const r = await pool.query(`
          SELECT
            TO_CHAR(${qDate}::DATE, 'YYYY-MM') AS month,
            ${qCat} AS category,
            ${qSubCat} AS subcat,
            SUM(${qAmt}) AS total
          FROM ${qTbl}
          WHERE ${notNoise}
            AND (${isOpIncome} OR ${isOpExpense})
            AND ${validDate}
          GROUP BY 1, 2, 3
          ORDER BY 1, 3
        `);
        if (r.rows.length > 0) {
          const monthBuckets: Record<string, Record<string, number>> = {};
          for (const row of r.rows as Record<string, unknown>[]) {
            const m = String(row.month ?? "");
            const sub = String(row.subcat ?? "");
            if (!monthBuckets[m]) monthBuckets[m] = {};
            monthBuckets[m][sub] = (monthBuckets[m][sub] || 0) + Number(row.total ?? 0);
          }
          const allSubcats = [...new Set(r.rows.map((row: Record<string, unknown>) => String(row.subcat ?? "")))];
          const pivotData = Object.entries(monthBuckets)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, vals]) => {
              const entry: Record<string, string | number> = { label: formatMonthLabel(month) };
              for (const s of allSubcats) entry[s] = vals[s] || 0;
              return entry;
            });
          if (pivotData.length > 0) {
            charts.push({
              id: "cashflow_summary",
              title: "Мөнгөн урсгалын дэлгэрэнгүй — сараар",
              type: "stacked_bar",
              data: pivotData,
              config: { xAxis: "label", yAxis: "value", series: allSubcats, stacked: true },
            });
          }
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // 8. Income statement
    if (subCatCol) {
      try {
        const r = await pool.query(`
          SELECT
            CASE WHEN ${isOpIncome} THEN 'Орлого' ELSE 'Зарлага' END AS section,
            ${qSubCat} AS subcat,
            SUM(${qAmt}) AS total
          FROM ${qTbl}
          WHERE ${notNoise} AND (${isOpIncome} OR ${isOpExpense})
            AND ${qSubCat} IS NOT NULL
          GROUP BY 1, 2
          ORDER BY 1, 3 DESC
        `);
      if (r.rows.length > 0) {
        const incomeRows = r.rows.filter((row: Record<string, unknown>) => row.section === "Орлого");
        const expenseRows = r.rows.filter((row: Record<string, unknown>) => row.section === "Зарлага");
        const topIncome = incomeRows.slice(0, 5);
        const topExpense = expenseRows.slice(0, 5);
        const labels = [...new Set([...topIncome.map((r: Record<string, unknown>) => String(r.subcat)), ...topExpense.map((r: Record<string, unknown>) => String(r.subcat))])];
        const incomeMap: Record<string, number> = {};
        const expenseMap: Record<string, number> = {};
        for (const r of topIncome) incomeMap[String(r.subcat)] = Number(r.total);
        for (const r of topExpense) expenseMap[String(r.subcat)] = Number(r.total);
        const barData = labels.map(l => ({
          label: l,
          Орлого: incomeMap[l] || 0,
          Зарлага: expenseMap[l] || 0,
        }));
        charts.push({
          id: "income_statement",
          title: "Орлого / Зарлагын төрлөөр",
          type: "bar",
          data: barData,
          config: { xAxis: "label", yAxis: "value", series: ["Орлого", "Зарлага"], stacked: false },
        });
      }
    } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // 9. Expense category stats
    if (subCatCol) {
      try {
        const r = await pool.query(`
          SELECT
            ${qSubCat} AS subcat,
            SUM(${qAmt}) AS total
          FROM ${qTbl}
          WHERE ${isOpExpense} AND ${qSubCat} IS NOT NULL
          GROUP BY 1
          ORDER BY 2 DESC
        `);
        if (r.rows.length > 0) {
          const totalExp = r.rows.reduce((s: number, row: any) => s + Number(row.total ?? 0), 0);
          const data = r.rows.map((row: Record<string, unknown>) => ({
            label: String(row.subcat ?? ""),
            value: Number(row.total ?? 0),
            pct: totalExp > 0 ? Math.round((Number(row.total ?? 0) / totalExp) * 1000) / 10 : 0,
          }));
          charts.push({
            id: "expense_category_stats",
            title: "Зарлагын ангилал — дүн ба хувь",
            type: "horizontal_bar",
            data,
            config: {
              xAxis: "label",
              yAxis: "value",
              description: "Үйл ажиллагааны зарлагыг дэд ангилалаар хувийн жинтэй нь харуулна",
            },
          });
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // Compute P&L summary
    const summaryRes = await pool.query(`
      SELECT
        SUM(CASE WHEN ${isOpIncome}  THEN ${qAmt} ELSE 0 END) AS total_income,
        SUM(CASE WHEN ${isOpExpense} THEN ${qAmt} ELSE 0 END) AS total_expense,
        COUNT(*) FILTER (WHERE ${notNoise}) AS total_transactions
      FROM ${qTbl}
    `);
    const totalIncome       = Math.round(Number(summaryRes.rows[0]?.total_income    || 0));
    const totalExpense      = Math.round(Number(summaryRes.rows[0]?.total_expense   || 0));
    const totalTransactions = Number(summaryRes.rows[0]?.total_transactions || 0);
    const operatingProfit   = totalIncome - totalExpense;

    let period = "";
    if (dateCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const pr = await pool.query(`
          SELECT
            EXTRACT(YEAR  FROM MIN(${qDate}::DATE)) AS min_year,
            EXTRACT(YEAR  FROM MAX(${qDate}::DATE)) AS max_year,
            EXTRACT(QUARTER FROM MIN(${qDate}::DATE)) AS min_q,
            EXTRACT(QUARTER FROM MAX(${qDate}::DATE)) AS max_q
          FROM ${qTbl}
          WHERE ${validDate}
        `);
        const row = pr.rows[0];
        const minY = row?.min_year;
        const maxY = row?.max_year;
        const minQ = row?.min_q;
        const maxQ = row?.max_q;
        if (minY != null && maxY != null) {
          if (minY === maxY) {
            if (minQ != null && minQ === maxQ) {
              period = `Q${minQ} ${minY}`;
            } else {
              period = `${minY} (Q${minQ}–Q${maxQ})`;
            }
          } else {
            period = `${minY}–${maxY}`;
          }
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    return res.json({
      isFinance: charts.length > 0,
      tableName: table,
      charts,
      period,
      summary: { totalIncome, totalExpense, operatingProfit, totalTransactions },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// Finance Audit
// ─────────────────────────────────────────────────────────────
router.get("/finance-audit", async (req, res) => {
  const userId = getUserId(req);

  try {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: "DB unavailable" });

    const entry = await getActiveCatalogEntry(userId);
    if (!entry) return res.json({ available: false });

    const table    = entry.table_name;
    const columns: string[] = JSON.parse(entry.columns_info);
    const catCol   = findConceptColumn(columns, "finance_category",    table);
    const subCatCol = findConceptColumn(columns, "finance_subcategory", table);
    const amtCol   = findConceptColumn(columns, "finance_amount",       table);

    if (!catCol || !amtCol) return res.json({ available: false });

    const qCat    = quoteIdent(catCol);
    const qSubCat = subCatCol ? quoteIdent(subCatCol) : null;
    const qAmt    = buildMntAmountExpr(quoteIdent(amtCol));
    const qTbl    = quoteIdent(table);

    const noiseFilter = buildNoiseSubcategoryFilter(qSubCat ?? qCat);
    const isOpIncome  = `(${qCat} ILIKE '%орлого%' AND ${qCat} NOT ILIKE '%зээл%')`;
    const isOpExpense = qSubCat
      ? `(${qCat} ILIKE '%зарлага%' AND ${qSubCat} NOT ILIKE '%зээл%' AND ${noiseFilter})`
      : `${qCat} ILIKE '%зарлага%'`;
    const isNoise = `(${qCat} ILIKE '%шилжүүлэг%' OR ${qCat} ILIKE '%эздийн зээл%'${qSubCat ? ` OR (${qCat} ILIKE '%зарлага%' AND NOT ${noiseFilter})` : ""})`;

    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE ${isOpIncome})                         AS income_rows,
        COUNT(*) FILTER (WHERE ${isOpExpense})                        AS expense_rows,
        COUNT(*) FILTER (WHERE ${isNoise})                            AS noise_rows,
        COUNT(*) FILTER (WHERE NOT ${isOpIncome} AND NOT ${isOpExpense} AND NOT ${isNoise}) AS unclassified_rows,
        COUNT(*)                                                       AS total_rows,
        COALESCE(SUM(${qAmt}) FILTER (WHERE ${isOpIncome}),  0)      AS income_total,
        COALESCE(SUM(${qAmt}) FILTER (WHERE ${isOpExpense}), 0)      AS expense_total
      FROM ${qTbl}
    `);

    const row = result.rows[0];
    return res.json({
      available: true,
      tableName: table,
      incomeRows:       Number(row.income_rows),
      expenseRows:      Number(row.expense_rows),
      noiseRows:        Number(row.noise_rows),
      unclassifiedRows: Number(row.unclassified_rows),
      totalRows:        Number(row.total_rows),
      incomeTotal:      Math.round(Number(row.income_total)),
      expenseTotal:     Math.round(Number(row.expense_total)),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// Table Passport
// ─────────────────────────────────────────────────────────────
router.get("/table-passport", async (req, res) => {
  try {
    const entry = await getActiveCatalogEntry(getUserId(req));
    if (!entry) return res.json({ available: false });

    const tableName = entry.table_name;
    const markdown = await getPassportByTableName(tableName);
    if (!markdown) return res.json({ available: false, tableName });

    const questions = parsePassportQuestions(markdown);
    const domainMatch = markdown.match(/\*\*Домэйн\*\*:\s*(.+)/);
    const industryMatch = markdown.match(/\*\*Салбар\*\*:\s*(.+)/);

    return res.json({
      available: questions.length > 0,
      tableName,
      questions,
      domain: domainMatch?.[1]?.trim() ?? "",
      industry: industryMatch?.[1]?.trim() ?? "",
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// Finance Detailed Reports
// ─────────────────────────────────────────────────────────────
router.get("/finance-reports", async (req, res) => {
  const userId = getUserId(req);
  const pool = getPool();

  try {
    const entry = await getActiveCatalogEntry(userId);
    if (!entry) return res.json({ isFinance: false });

    const columns: string[] = JSON.parse(entry.columns_info);
    const table = entry.table_name;

    const amtCol    = findConceptColumn(columns, "finance_amount",      table);
    const catCol    = findConceptColumn(columns, "finance_category",    table);
    const subCatCol = findConceptColumn(columns, "finance_subcategory", table);
    const dateCol   = findConceptColumn(columns, "finance_date",        table);

    if (!amtCol || !catCol) return res.json({ isFinance: false });

    const qAmt    = buildMntAmountExpr(quoteIdent(amtCol));
    const qCat    = quoteIdent(catCol);
    const qSubCat = subCatCol ? quoteIdent(subCatCol) : null;
    const _qDate   = dateCol  ? quoteIdent(dateCol) : null;
    const qTbl    = quoteIdent(table);

    const isOpIncome  = `(${qCat} ILIKE '%орлого%' AND ${qCat} NOT ILIKE '%зээл%')`;
    const isOpExpense = qSubCat
      ? `(${qCat} ILIKE '%зарлага%' AND ${qSubCat} NOT ILIKE '%зээл%' AND ${buildNoiseSubcategoryFilter(qSubCat)})`
      : `${qCat} ILIKE '%зарлага%'`;
    const notNoise = `${qCat} NOT ILIKE '%шилжүүлэг%' AND ${qCat} NOT ILIKE '%эздийн зээл%'`;

    // 1. Income Statement
    let incomeStatement = null;
    if (subCatCol) {
      try {
        const r = await pool.query(`
          SELECT
            CASE WHEN ${isOpIncome} THEN 'Орлого' ELSE 'Зарлага' END AS section,
            ${qSubCat} AS subcat,
            SUM(${qAmt}) AS total
          FROM ${qTbl}
          WHERE ${notNoise} AND (${isOpIncome} OR ${isOpExpense})
            AND ${qSubCat} IS NOT NULL
          GROUP BY 1, 2
          ORDER BY 1, 3 DESC
        `);
        if (r.rows.length > 0) {
          const incomeRows = r.rows
            .filter((row: Record<string, unknown>) => row.section === "Орлого")
            .map((row: Record<string, unknown>) => ({ subcategory: String(row.subcat ?? ""), amount: Math.round(Number(row.total ?? 0)) }));
          const expenseRows = r.rows
            .filter((row: Record<string, unknown>) => row.section === "Зарлага")
            .map((row: Record<string, unknown>) => ({ subcategory: String(row.subcat ?? ""), amount: Math.round(Number(row.total ?? 0)) }));
          const totalIncomeVal = incomeRows.reduce((s: number, r: any) => s + r.amount, 0);
          const totalExpenseVal = expenseRows.reduce((s: number, r: any) => s + r.amount, 0);
          incomeStatement = {
            incomeRows,
            expenseRows,
            totalIncome: totalIncomeVal,
            totalExpense: totalExpenseVal,
            operatingProfit: totalIncomeVal - totalExpenseVal,
          };
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // 2. Expense Breakdown with Monthly Pivot
    let expenseBreakdown = null;
    if (subCatCol && dateCol) {
      try {
        const qD = quoteIdent(dateCol);
        const r = await pool.query(`
          SELECT
            ${qSubCat} AS subcat,
            TO_CHAR(${qD}::DATE, 'YYYY-MM') AS month,
            SUM(${qAmt}) AS total
          FROM ${qTbl}
          WHERE ${isOpExpense} AND ${qSubCat} IS NOT NULL AND ${qD} IS NOT NULL
          GROUP BY 1, 2
          ORDER BY 1, 2
        `);
        if (r.rows.length > 0) {
          const subcatTotals: Record<string, number> = {};
          const monthMap: Record<string, Record<string, number>> = {};
          const monthSet = new Set<string>();
          for (const row of r.rows as Record<string, unknown>[]) {
            const s = String(row.subcat ?? "");
            const m = String(row.month ?? "");
            const v = Math.round(Number(row.total ?? 0));
            subcatTotals[s] = (subcatTotals[s] || 0) + v;
            if (!monthMap[s]) monthMap[s] = {};
            monthMap[s][m] = (monthMap[s][m] || 0) + v;
            monthSet.add(m);
          }

          const sortedSubcats = Object.entries(subcatTotals)
            .sort((a, b) => b[1] - a[1])
            .map(([k]) => k);

          const sortedMonths = [...monthSet].sort();

          const grandTotal = sortedSubcats.reduce((s, c) => s + (subcatTotals[c] || 0), 0);

          const rows = sortedSubcats.map(cat => {
            const monthly = sortedMonths.map(m => monthMap[cat]?.[m] ?? 0);
            const total = subcatTotals[cat] || 0;
            const pct = grandTotal > 0 ? Math.round((total / grandTotal) * 1000) / 10 : 0;
            return { category: cat, monthly, total, pct };
          });

          const monthLabels = sortedMonths.map((m) => {
            const parts = m.split("-");
            return `${parseInt(parts[1], 10)}-р сар`;
          });

          expenseBreakdown = { categories: sortedSubcats, months: monthLabels, rows, grandTotal };
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // 3. Cash Flow
    let cashFlow = null;
    if (subCatCol) {
      try {
        const r = await pool.query(`
          SELECT
            ${qSubCat} AS subcat,
            SUM(${qAmt}) AS total,
            CASE
              WHEN ${isOpIncome} THEN 'inflow'
              WHEN ${qCat} ILIKE '%зээл%' OR ${qCat} ILIKE '%хөрөнгө оруулалт%' THEN 'financing'
              WHEN ${isOpExpense} THEN 'outflow'
              ELSE 'other'
            END AS flow_type
          FROM ${qTbl}
          WHERE ${qSubCat} IS NOT NULL AND ${qCat} NOT ILIKE '%шилжүүлэг%'
          GROUP BY 1, flow_type
          ORDER BY flow_type, 2 DESC
        `);
        if (r.rows.length > 0) {
          const inflowRows = r.rows
            .filter((row: Record<string, unknown>) => row.flow_type === "inflow")
            .map((row: Record<string, unknown>) => ({ name: String(row.subcat ?? ""), amount: Math.round(Number(row.total ?? 0)) }));
          const financingRows = r.rows
            .filter((row: Record<string, unknown>) => row.flow_type === "financing")
            .map((row: Record<string, unknown>) => ({ name: String(row.subcat ?? ""), amount: Math.round(Number(row.total ?? 0)) }));
          const outflowRows = r.rows
            .filter((row: Record<string, unknown>) => row.flow_type === "outflow")
            .map((row: Record<string, unknown>) => ({ name: String(row.subcat ?? ""), amount: Math.round(Number(row.total ?? 0)) }));
          const otherRows = r.rows
            .filter((row: Record<string, unknown>) => row.flow_type === "other")
            .map((row: Record<string, unknown>) => ({ name: String(row.subcat ?? ""), amount: Math.round(Number(row.total ?? 0)) }));

          const sections: Array<{ name: string; items: Array<{ name: string; amount: number }>; subtotal: number }> = [];
          if (inflowRows.length > 0) {
            sections.push({
              name: "Үйл ажиллагааны орлого",
              items: inflowRows,
              subtotal: inflowRows.reduce((s: number, r: any) => s + Math.abs(r.amount), 0),
            });
          }
          if (financingRows.length > 0) {
            sections.push({
              name: "Санхүүжилт",
              items: financingRows,
              subtotal: financingRows.reduce((s: number, r: any) => s + Math.abs(r.amount), 0),
            });
          }
          if (outflowRows.length > 0) {
            sections.push({
              name: "Үйл ажиллагааны зарлага",
              items: outflowRows,
              subtotal: -outflowRows.reduce((s: number, r: any) => s + Math.abs(r.amount), 0),
            });
          }
          if (otherRows.length > 0) {
            sections.push({
              name: "Бусад",
              items: otherRows,
              subtotal: otherRows.reduce((s: number, r: any) => s + r.amount, 0),
            });
          }

          const totalInflow = inflowRows.reduce((s: number, r: any) => s + r.amount, 0)
            + financingRows.reduce((s: number, r: any) => s + r.amount, 0);
          const totalOutflow = outflowRows.reduce((s: number, r: any) => s + r.amount, 0);
          const netCashFlow = totalInflow - totalOutflow;

          cashFlow = { sections, netCashFlow };
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    return res.json({
      isFinance: !!(incomeStatement || expenseBreakdown || cashFlow),
      incomeStatement,
      expenseBreakdown,
      cashFlow,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
