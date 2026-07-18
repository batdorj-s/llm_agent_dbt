import type { IKpiRepository, KpiMetric, SalesRecord, DateFilter } from "./types.js";
import { initDataLake, getPool } from "./data-lake.js";

const MART_SALES = "kpi_sales";
const MART_USERS = "user_metrics";

export class MartsKpiRepository implements IKpiRepository {
    async getKpi(metric: KpiMetric["name"], dateFilter?: DateFilter, userId?: string): Promise<KpiMetric | null> {
        try {
            await initDataLake();

            const targetResult = await getPool().query(
                `SELECT target_value, unit FROM kpi_targets WHERE metric_name = $1`,
                [metric]
            );
            const targetRow = targetResult.rows[0] as any;
            if (!targetRow) return null;

            const params: any[] = [];
            let dateWhere = "";
            if (metric === "sales" || metric === "users") {
                const dateCol = metric === "sales" ? "order_date" : "last_order_date";
                if (dateFilter?.startDate) {
                    params.push(dateFilter.startDate);
                    dateWhere += ` AND ${dateCol} >= $${params.length}`;
                }
                if (dateFilter?.endDate) {
                    params.push(dateFilter.endDate);
                    dateWhere += ` AND ${dateCol} <= $${params.length}`;
                }
            }

            let current = 0;

            if (metric === "sales") {
                const result = await getPool().query(
                    `SELECT COALESCE(SUM(total_sales), 0) as total FROM ${MART_SALES} WHERE 1=1${dateWhere}`,
                    params
                );
                current = Number(result.rows[0]?.total || 0);
            } else if (metric === "users") {
                const result = await getPool().query(
                    `SELECT COUNT(DISTINCT customer_id) as count FROM ${MART_USERS} WHERE 1=1${dateWhere}`,
                    params
                );
                current = Number(result.rows[0]?.count || 0);
            } else if (metric === "churn_rate") {
                const result = await getPool().query(
                    `SELECT COUNT(*) FILTER (WHERE last_order_date < CURRENT_DATE - INTERVAL '6 months') * 100.0 / NULLIF(COUNT(*), 0) as rate FROM ${MART_USERS}`
                );
                current = Number(result.rows[0]?.rate || 0);
            }

            return {
                name: metric,
                current: Math.round(current * 100) / 100,
                target: targetRow.target_value,
                unit: targetRow.unit,
                updatedAt: new Date().toISOString()
            };
        } catch (err) {
            console.warn(`[MartsRepo] getKpi failed for ${metric}:`, (err as Error).message);
            return null;
        }
    }

    async getSalesHistory(limit: number, dateFilter?: DateFilter, _userId?: string): Promise<SalesRecord[]> {
        try {
            await initDataLake();

            const params: any[] = [];
            const whereClauses: string[] = [];

            if (dateFilter?.startDate) {
                whereClauses.push(`order_date >= $${params.length + 1}`);
                params.push(dateFilter.startDate);
            }
            if (dateFilter?.endDate) {
                whereClauses.push(`order_date <= $${params.length + 1}`);
                params.push(dateFilter.endDate);
            }
            const whereSQL = whereClauses.length > 0 ? " WHERE " + whereClauses.join(" AND ") : "";

            const rows = await getPool().query(`
                SELECT
                    DATE_TRUNC('month', order_date)::date AS month,
                    SUM(total_sales) AS revenue
                FROM ${MART_SALES}
                ${whereSQL}
                GROUP BY month
                ORDER BY month DESC
                LIMIT $${params.length + 1}
            `, [...params, limit]);

            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

            return [...rows.rows].reverse().map((row: any) => {
                const d = new Date(row.month);
                return {
                    month: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
                    revenue: Math.round(Number(row.revenue) || 0)
                };
            });
        } catch (err) {
            console.warn(`[MartsRepo] getSalesHistory failed:`, (err as Error).message);
            return [];
        }
    }

    async updateKpiTarget(metric: KpiMetric["name"], target: number): Promise<void> {
        await initDataLake();
        await getPool().query(
            `UPDATE kpi_targets SET target_value = $1 WHERE metric_name = $2`,
            [target, metric]
        );
    }
}
