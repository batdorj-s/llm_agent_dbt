import { IKpiRepository, KpiMetric, SalesRecord, DateFilter } from "./types.js";
import { initDataLake, getPool } from "./data-lake.js";

function buildDateWhere(tableInfo: { dateCol: string }, df?: DateFilter): string {
    if (!df?.startDate && !df?.endDate) return "";
    const clauses: string[] = [];
    if (df.startDate) clauses.push(`"${tableInfo.dateCol}" >= '${df.startDate}'`);
    if (df.endDate) clauses.push(`"${tableInfo.dateCol}" <= '${df.endDate}'`);
    return " AND " + clauses.join(" AND ");
}

export class SQLiteKpiRepository implements IKpiRepository {
    constructor() {
        // Data Lake tables (kpi_targets, etc.) are initialized by initDataLake()
    }

    async getKpi(metric: KpiMetric["name"], dateFilter?: DateFilter): Promise<KpiMetric | null> {
        return this.getKpiFallback(metric, dateFilter);
    }

    private async getKpiFallback(metric: KpiMetric["name"], dateFilter?: DateFilter): Promise<KpiMetric | null> {
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

            const dateWhere = buildDateWhere(tableInfo, dateFilter);
            if (metric === "sales") {
                const result = await getPool().query(
                    `SELECT COALESCE(SUM(CAST("${tableInfo.salesCol}" AS NUMERIC)), 0) as total FROM "${tableInfo.tableName}" WHERE 1=1${dateWhere}`
                );
                current = Number(result.rows[0]?.total || 0);
            } else if (metric === "users") {
                const result = await getPool().query(
                    `SELECT COUNT(DISTINCT "${tableInfo.userCol}") as count FROM "${tableInfo.tableName}" WHERE 1=1${dateWhere}`
                );
                current = Number(result.rows[0]?.count || 0);
            } else if (metric === "churn_rate") {
                const result = await getPool().query(
                    `SELECT COUNT(*) FILTER (WHERE "${tableInfo.dateCol}" IS NULL) * 100.0 / NULLIF(COUNT(*), 0) as rate FROM "${tableInfo.tableName}" WHERE 1=1${dateWhere}`
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

        const typeResult = await getPool().query(
            `SELECT column_name, data_type FROM information_schema.columns
             WHERE table_name = $1 AND table_schema = 'public'`,
            [catalog.table_name]
        );
        const typeMap = new Map<string, string>();
        for (const row of typeResult.rows as Array<{ column_name: string; data_type: string }>) {
            typeMap.set(row.column_name.toLowerCase(), row.data_type);
        }

        const isNumeric = (col: string) => {
            const t = typeMap.get(col.toLowerCase());
            return t && /numeric|integer|double|real|float|money|dec/i.test(t);
        };

        const salesCol = columns.find(c => /amount|sales|revenue|price/i.test(c))
            || columns.find(c => /total|income|spend|value|cost|profit/i.test(c))
            || columns.find(c => isNumeric(c))
            || null;
        if (!salesCol) return null;

        const userCol = columns.find(c => /customer_id|user_id|_id/i.test(c))
            || columns.find(c => /customer|client|user|member|account/i.test(c))
            || null;
        if (!userCol) return null;

        const dateCol = columns.find(c => /date|time/i.test(c))
            || columns.find(c => /timestamp/i.test(c))
            || columns.find(c => /year|month|day/i.test(c))
            || null;
        if (!dateCol) return null;

        return { tableName: catalog.table_name, salesCol, userCol, dateCol };
    }

    async getSalesHistory(limit: number, dateFilter?: DateFilter): Promise<SalesRecord[]> {
        return this.getSalesHistoryFallback(limit, dateFilter);
    }

    private async getSalesHistoryFallback(limit: number, dateFilter?: DateFilter): Promise<SalesRecord[]> {
        try {
            const tableInfo = await this.getActiveTableInfo();
            if (!tableInfo) return [];

            await initDataLake();
            const dateWhere = buildDateWhere(tableInfo, dateFilter);
            const rows = await getPool().query(`
                SELECT
                    TO_CHAR(REPLACE("${tableInfo.dateCol}", '.', '-')::timestamp, 'YYYY-MM') as month,
                    SUM(CAST("${tableInfo.salesCol}" AS NUMERIC)) as revenue
                FROM "${tableInfo.tableName}"
                WHERE 1=1${dateWhere}
                GROUP BY month
                ORDER BY month DESC
                LIMIT $1
            `, [limit]);

            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

            return [...rows.rows].reverse().map(row => {
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
            console.warn(`[DB] Sales history fallback failed: ${err instanceof Error ? err.message : String(err)}`);
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
