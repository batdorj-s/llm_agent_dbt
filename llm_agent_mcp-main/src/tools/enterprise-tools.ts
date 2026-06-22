import { getRepository } from "../db/kpi-repository.js";
import { getCatalog, executeSql } from "../db/data-lake.js";

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
