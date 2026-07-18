import { getRepository } from "../db/kpi-repository.js";
import { getCatalog, executeSql, quoteIdent } from "../db/data-lake.js";
import { FINANCE_COMBINED_TABLE } from "../db/ingestion.js";

export type KpiMetricName = "sales" | "users" | "churn_rate";

export async function handleGetKpi({ metric }: { metric: KpiMetricName }) {
  const repo = await getRepository();
  const data = await repo.getKpi(metric);

  if (!data) {
    return { text: `Error: Metric '${metric}' not found.`, ok: false as const };
  }

  const pct = ((data.current / data.target) * 100).toFixed(1);
  const status = data.current >= data.target ? "[OK] On target" : "[WARN] Below target";

  const resultText = [
    `KPI Metric: ${metric.toUpperCase()}`,
    `Current:    ${data.current} ${data.unit}`,
    `Target:     ${data.target} ${data.unit}`,
    `Progress:   ${pct}% — ${status}`,
    ...(data.updatedAt ? [`Updated:    ${new Date(data.updatedAt).toLocaleString()}`] : []),
  ].join("\n");

  return { text: resultText, ok: true as const, data };
}

export async function handleGetSalesHistory({ limit = 3 }: { limit?: number }) {
  const repo = await getRepository();
  const records = await repo.getSalesHistory(limit);

  if (records.length === 0) {
    return { text: "No sales history available.", ok: false as const };
  }

  const total = records.reduce((sum, r) => sum + r.revenue, 0);
  const avg = (total / records.length).toFixed(0);

  const lines = records.map((r) => `  ${r.month}: $${r.revenue.toLocaleString()}`);
  const resultText = [
    `Sales History (last ${records.length} months):`,
    ...lines,
    `─────────────────────────`,
    `  Total:   $${total.toLocaleString()}`,
    `  Average: $${Number(avg).toLocaleString()} / month`,
  ].join("\n");

  return { text: resultText, ok: true as const, records };
}

export async function handleGetCatalog({ userId }: { userId: string }) {
  try {
    const catalog = await getCatalog(userId);
    if (!catalog || catalog.length === 0) {
      return { text: "Data Lake catalog is empty.", ok: false as const };
    }

    const lines = catalog.map(
      (row: { table_name: string; created_by: string | null; created_at: string; columns_info: string; description: string | null }) =>
        `Table: ${row.table_name}\nOwner: ${row.created_by}\nVisibility: ${(row as any).visibility}\nCreated At: ${row.created_at}\nColumns: ${row.columns_info}\nDescription: ${row.description}\n`
    );

    return { text: `Data Lake Catalog:\n\n${lines.join("\n---\n")}`, ok: true as const, catalog };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: `Error fetching catalog: ${message}`, ok: false as const };
  }
}

export async function handleExecuteSql({ query, userId }: { query: string; userId: string }) {
  try {
    console.log(`[Enterprise Tools] Executing SQL: ${query}`);
    const results = await executeSql(query, true, userId);
    return { text: JSON.stringify(results, null, 2), ok: true as const, results };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const clean = message.replace(/^SQL Execution Error:\s*/, "");
    return { text: clean, ok: false as const };
  }
}

export async function buildFinanceKpiContext(query: string): Promise<string> {
  const lower = query.toLowerCase();
  const sections: string[] = [];

  const isFinanceQuery = /sales|revenue|борлуулалт|орлого|зарлага|ашиг|expense|income|profit|санхүү|төсөв|тайлан|касс|банк|гүйлгээ|transaction|cash|flow|мөнгөн.урсгал|категори|ангилал|дэд.ангилал|цалин|түрээс|маркетинг|нийтийн|үйлчилгээ|хэрэглэгч|user|customer|харилцагч|үзүүлэлт|indicator|kpi/i.test(lower);

  if (isFinanceQuery) {
    try {
      const qNiitOrlogo    = quoteIdent("нийт_орлого");
      const qNiitZarlag    = quoteIdent("нийт_зарлага");
      const qNiitGuilgee   = quoteIdent("ийт_гүйлгээ");
      const qEhlekhOgnoo   = quoteIdent("эхлэх_огноо");
      const qDuusakhOgnoo  = quoteIdent("дуусах_огноо");
      const summaryResult = await executeSql(`
        SELECT
          COALESCE(SUM(CASE WHEN category = 'орлого' THEN amount ELSE 0 END), 0) AS ${qNiitOrlogo},
          COALESCE(SUM(CASE WHEN category = 'зарлага' THEN amount ELSE 0 END), 0) AS ${qNiitZarlag},
          COUNT(*) AS ${qNiitGuilgee},
          MIN(date) AS ${qEhlekhOgnoo},
          MAX(date) AS ${qDuusakhOgnoo}
        FROM ${FINANCE_COMBINED_TABLE}
        WHERE category IN ('орлого', 'зарлага')
      `, true, "system");
      if (summaryResult && summaryResult.length > 0) {
        const s = summaryResult[0] as any;
        const totalIncome = Number(s[qNiitOrlogo] || 0);
        const totalExpense = Number(s[qNiitZarlag] || 0);
        const profit = totalIncome - totalExpense;
        sections.push(
          `Санхүүгийн хураангуй (${FINANCE_COMBINED_TABLE} хүснэгтээс):\n` +
          `  Нийт орлого: ${totalIncome.toLocaleString()} ₮\n` +
          `  Нийт зарлага: ${totalExpense.toLocaleString()} ₮\n` +
          `  Үйл ажиллагааны ашиг: ${profit.toLocaleString()} ₮\n` +
          `  Нийт гүйлгээ: ${Number(s[qNiitGuilgee] || 0).toLocaleString()}\n` +
          `  Хугацаа: ${s[qEhlekhOgnoo] || "N/A"} → ${s[qDuusakhOgnoo] || "N/A"}`
        );
      }
    } catch (e) {
      console.warn("[buildFinanceKpiContext] Summary query failed:", (e as Error).message);
    }

    try {
      const qNiit = quoteIdent("нийт");
      const qXuvi = quoteIdent("хувь");
      const expenseByCategory = await executeSql(`
        SELECT subcategory, SUM(amount) AS ${qNiit},
          ROUND(SUM(amount) * 100.0 / NULLIF((SELECT SUM(amount) FROM ${FINANCE_COMBINED_TABLE} WHERE category = 'зарлага'), 0), 1) AS ${qXuvi}
        FROM ${FINANCE_COMBINED_TABLE}
        WHERE category = 'зарлага'
        GROUP BY subcategory
        ORDER BY ${qNiit} DESC
      `, true, "system");
      if (expenseByCategory && expenseByCategory.length > 0) {
        const lines = (expenseByCategory as any[]).map((r: any) =>
          `  ${r.subcategory || "(тодорхойгүй)"}: ${Number(r[qNiit] || 0).toLocaleString()} ₮ (${r[qXuvi] || 0}%)`
        );
        sections.push(`Зардлын задаргаа (дэд ангилалаар):\n${lines.join("\n")}`);
      }
    } catch (e) {
      console.warn("[buildFinanceKpiContext] Expense breakdown query failed:", (e as Error).message);
    }

    try {
      const qNiitIncome = quoteIdent("нийт");
      const incomeByCategory = await executeSql(`
        SELECT subcategory, SUM(amount) AS ${qNiitIncome}
        FROM ${FINANCE_COMBINED_TABLE}
        WHERE category = 'орлого'
        GROUP BY subcategory
        ORDER BY ${qNiitIncome} DESC
      `, true, "system");
      if (incomeByCategory && incomeByCategory.length > 0) {
        const lines = (incomeByCategory as any[]).map((r: any) =>
          `  ${r.subcategory || "(тодорхойгүй)"}: ${Number(r[qNiitIncome] || 0).toLocaleString()} ₮`
        );
        sections.push(`Орлогын задаргаа (дэд ангилалаар):\n${lines.join("\n")}`);
      }
    } catch (e) {
      console.warn("[buildFinanceKpiContext] Income breakdown query failed:", (e as Error).message);
    }
  }

  if (/sales|revenue|борлуулалт|орлого/i.test(lower)) {
    const result = await handleGetKpi({ metric: "sales" });
    if (result.ok) sections.push(result.text);
  }
  if (/users|хэрэглэгч|active user/i.test(lower)) {
    const result = await handleGetKpi({ metric: "users" });
    if (result.ok) sections.push(result.text);
  }
  if (/churn|retention|хэрэглэгч.*алдаг/i.test(lower)) {
    const result = await handleGetKpi({ metric: "churn_rate" });
    if (result.ok) sections.push(result.text);
  }
  if (/history|trend|сар|monthly|өмнөх/i.test(lower)) {
    const result = await handleGetSalesHistory({ limit: 6 });
    if (result.ok) sections.push(result.text);
  }

  return sections.length > 0
    ? sections.join("\n\n---\n\n")
    : "";
}

export function isPythonQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return /\b(python|pandas|matplotlib|numpy|scipy|plot|chart code|код ажиллуул|python код)\b/i.test(lower);
}
