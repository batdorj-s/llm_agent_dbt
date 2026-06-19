import { IKpiRepository, KpiMetric, SalesRecord } from "./types.js";
import { initDataLake, getPool } from "./data-lake.js";

export class SQLiteKpiRepository implements IKpiRepository {
    constructor() {
        // Data Lake tables (kpi_targets, etc.) are initialized by initDataLake()
    }

    async getKpi(metric: KpiMetric["name"]): Promise<KpiMetric | null> {
        try {
            await initDataLake();

            const targetResult = await getPool().query(
                `SELECT target_value, unit FROM kpi_targets WHERE metric_name = $1`,
                [metric]
            );
            const targetRow = targetResult.rows[0] as any;
            if (!targetRow) return null;

            let current = 0;

            if (metric === "sales") {
                const result = await getPool().query(`SELECT COALESCE(SUM(total_sales), 0) as total FROM kpi_sales`);
                current = Number(result.rows[0]?.total || 0);
            } else if (metric === "users") {
                const result = await getPool().query(`SELECT COUNT(DISTINCT customer_id) as count FROM user_metrics`);
                current = Number(result.rows[0]?.count || 0);
            } else if (metric === "churn_rate") {
                const result = await getPool().query(`
                    SELECT
                        (SELECT COUNT(*) FROM user_metrics WHERE total_orders = 1) * 100.0 /
                        NULLIF((SELECT COUNT(*) FROM user_metrics), 0) as rate
                `);
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
            console.warn(`[DB] dbt views not found, falling back to raw table for KPI ${metric}`);
            return this.getKpiFallback(metric);
        }
    }

    private async getKpiFallback(metric: KpiMetric["name"]): Promise<KpiMetric | null> {
        try {
            await initDataLake();

            const targetResult = await getPool().query(
                `SELECT target_value, unit FROM kpi_targets WHERE metric_name = $1`,
                [metric]
            );
            const targetRow = targetResult.rows[0] as any;
            if (!targetRow) return null;

            const tableInfo = await this.getActiveTableInfo();
            if (!tableInfo) return null;

            let current = 0;

            if (metric === "sales") {
                const result = await getPool().query(
                    `SELECT COALESCE(SUM(CAST("${tableInfo.salesCol}" AS NUMERIC)), 0) as total FROM "${tableInfo.tableName}"`
                );
                current = Number(result.rows[0]?.total || 0);
            } else if (metric === "users") {
                const result = await getPool().query(
                    `SELECT COUNT(DISTINCT "${tableInfo.userCol}") as count FROM "${tableInfo.tableName}"`
                );
                current = Number(result.rows[0]?.count || 0);
            }

            return {
                name: metric,
                current: Math.round(current * 100) / 100,
                target: targetRow.target_value,
                unit: targetRow.unit,
                updatedAt: new Date().toISOString()
            };
        } catch (err) {
            return null;
        }
    }

    private async getActiveTableInfo(): Promise<{ tableName: string; salesCol: string; userCol: string; dateCol: string } | null> {
        const catalogResult = await getPool().query(
            `SELECT * FROM data_lake_catalog ORDER BY created_at DESC LIMIT 1`
        );
        const catalog = catalogResult.rows[0] as any;
        if (!catalog) return null;

        const columns = JSON.parse(catalog.columns_info) as string[];
        const salesCol = columns.find(c => /amount|sales|revenue|price/i.test(c)) || columns[columns.length - 1];
        const userCol = columns.find(c => /customer_id|user_id|_id/i.test(c)) || columns[0];
        const dateCol = columns.find(c => /date|time/i.test(c)) || columns[1] || "date";

        return { tableName: catalog.table_name, salesCol, userCol, dateCol };
    }

    async getSalesHistory(limit: number): Promise<SalesRecord[]> {
        try {
            await initDataLake();
            const rows = await getPool().query(`
                SELECT
                    TO_CHAR(order_date::timestamp, 'YYYY-MM') as month,
                    SUM(total_sales) as revenue
                FROM kpi_sales
                GROUP BY month
                ORDER BY month DESC
                LIMIT $1
            `, [limit]);

            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

            return rows.rows.reverse().map(row => {
                if (!row.month) return { month: "Unknown", revenue: row.revenue };
                const parts = row.month.split("-");
                const year = parts[0];
                const monthIdx = parseInt(parts[1]) - 1;
                return {
                    month: `${monthNames[monthIdx]} ${year}`,
                    revenue: Math.round(row.revenue)
                };
            });
        } catch (err) {
            console.warn("[DB] kpi_sales view not found, falling back to raw table for history");
            return this.getSalesHistoryFallback(limit);
        }
    }

    private async getSalesHistoryFallback(limit: number): Promise<SalesRecord[]> {
        try {
            const tableInfo = await this.getActiveTableInfo();
            if (!tableInfo) return [];

            await initDataLake();
            const rows = await getPool().query(`
                SELECT
                    TO_CHAR(REPLACE("${tableInfo.dateCol}", '.', '-')::timestamp, 'YYYY-MM') as month,
                    SUM(CAST("${tableInfo.salesCol}" AS NUMERIC)) as revenue
                FROM "${tableInfo.tableName}"
                GROUP BY month
                ORDER BY month DESC
                LIMIT $1
            `, [limit]);

            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

            return rows.rows.reverse().map(row => {
                if (!row.month) return { month: "Unknown", revenue: row.revenue };
                const parts = row.month.split("-");
                const year = parts[0];
                const monthIdx = parseInt(parts[1]) - 1;
                return {
                    month: `${monthNames[monthIdx]} ${year}`,
                    revenue: Math.round(row.revenue)
                };
            });
        } catch (err) {
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
