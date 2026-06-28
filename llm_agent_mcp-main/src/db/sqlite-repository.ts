import { IKpiRepository, KpiMetric, SalesRecord, DateFilter } from "./types.js";
import { initDataLake, getPool } from "./data-lake.js";

function buildDateWhere(tableInfo: { dateCol: string }, df?: DateFilter, paramOffset: number = 0): { clause: string; params: any[] } {
    if (!df?.startDate && !df?.endDate) return { clause: "", params: [] };
    const clauses: string[] = [];
    const params: any[] = [];
    if (df.startDate) {
        clauses.push(`"${tableInfo.dateCol}" >= $${paramOffset + params.length + 1}`);
        params.push(df.startDate);
    }
    if (df.endDate) {
        clauses.push(`"${tableInfo.dateCol}" <= $${paramOffset + params.length + 1}`);
        params.push(df.endDate);
    }
    return { clause: " AND " + clauses.join(" AND "), params };
}

export class SQLiteKpiRepository implements IKpiRepository {
    constructor() {
        // Data Lake tables (kpi_targets, etc.) are initialized by initDataLake()
    }

    async getKpi(metric: KpiMetric["name"], dateFilter?: DateFilter, userId?: string): Promise<KpiMetric | null> {
        return this.getKpiFallback(metric, dateFilter, userId);
    }

    private async getKpiFallback(metric: KpiMetric["name"], dateFilter?: DateFilter, userId?: string): Promise<KpiMetric | null> {
        try {
            await initDataLake();

            const targetResult = await getPool().query(
                `SELECT target_value, unit FROM kpi_targets WHERE metric_name = $1`,
                [metric]
            );
            const targetRow = targetResult.rows[0] as any;
            if (!targetRow) return null;

            const tableInfo = await this.getActiveTableInfo(userId);
            if (!tableInfo) return null;

            let current = 0;

            const { clause: dateWhere, params: dateParams } = buildDateWhere(tableInfo, dateFilter);
            if (metric === "sales") {
                const result = await getPool().query(
                    `SELECT COALESCE(SUM(CAST("${tableInfo.salesCol}" AS NUMERIC)), 0) as total FROM "${tableInfo.tableName}" WHERE 1=1${dateWhere}`,
                    dateParams
                );
                current = Number(result.rows[0]?.total || 0);
            } else if (metric === "users") {
                const result = await getPool().query(
                    `SELECT COUNT(DISTINCT "${tableInfo.userCol}") as count FROM "${tableInfo.tableName}" WHERE 1=1${dateWhere}`,
                    dateParams
                );
                current = Number(result.rows[0]?.count || 0);
            } else if (metric === "churn_rate") {
                const result = await getPool().query(
                    `SELECT COUNT(*) FILTER (WHERE "${tableInfo.dateCol}" IS NULL) * 100.0 / NULLIF(COUNT(*), 0) as rate FROM "${tableInfo.tableName}" WHERE 1=1${dateWhere}`,
                    dateParams
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

    private async getActiveTableInfo(userId?: string): Promise<{ tableName: string; salesCol: string; userCol: string; dateCol: string } | null> {
        if (userId) {
            const fileCheck = await getPool().query(
                `SELECT id FROM uploaded_files WHERE type = 'dataset' AND owner_id = $1 LIMIT 1`,
                [userId]
            );
            if (fileCheck.rows.length === 0) return null;
        }

        const catalogResult = await getPool().query(
            userId
                ? `SELECT * FROM data_lake_catalog WHERE owner_id = $1 ORDER BY created_at DESC`
                : `SELECT * FROM data_lake_catalog ORDER BY created_at DESC`,
            userId ? [userId] : []
        );
        if (catalogResult.rows.length === 0) return null;

        const typeResult = await getPool().query(
            `SELECT column_name, data_type FROM information_schema.columns
             WHERE table_schema = 'public'`
        );
        const typeMap = new Map<string, string>();
        for (const row of typeResult.rows as Array<{ column_name: string; data_type: string }>) {
            typeMap.set(row.column_name.toLowerCase(), row.data_type);
        }

        const isNumeric = (col: string) => {
            const t = typeMap.get(col.toLowerCase());
            return t && /numeric|integer|double|real|float|money|dec/i.test(t);
        };

        for (const catalog of catalogResult.rows as Array<any>) {
            let columns: string[];
            try {
                columns = JSON.parse(catalog.columns_info) as string[];
            } catch {
                continue;
            }

            const salesCol = columns.find(c => /amount|sales|revenue|price/i.test(c))
                || columns.find(c => /total|income|spend|value|cost|profit/i.test(c))
                || columns.find(c => isNumeric(c))
                || null;
            if (!salesCol) continue;

            const userCol = columns.find(c => /customer_id|user_id|_id/i.test(c))
                || columns.find(c => /customer|client|user|member|account/i.test(c))
                || null;
            if (!userCol) continue;

            const dateCol = columns.find(c => /date|time/i.test(c))
                || columns.find(c => /timestamp/i.test(c))
                || columns.find(c => /year|month|day/i.test(c))
                || null;
            if (!dateCol) continue;

            return { tableName: catalog.table_name, salesCol, userCol, dateCol };
        }

        return null;
    }

    async getSalesHistory(limit: number, dateFilter?: DateFilter, userId?: string): Promise<SalesRecord[]> {
        return this.getSalesHistoryFallback(limit, dateFilter, userId);
    }

    private async getSalesHistoryFallback(limit: number, dateFilter?: DateFilter, userId?: string): Promise<SalesRecord[]> {
        try {
            const tableInfo = await this.getActiveTableInfo(userId);
            if (!tableInfo) return [];

            await initDataLake();
            const { clause: dateWhere, params: dateParams } = buildDateWhere(tableInfo, dateFilter);
            const rows = await getPool().query(`
                SELECT
                    TO_CHAR(REPLACE("${tableInfo.dateCol}", '.', '-')::timestamp, 'YYYY-MM') as month,
                    SUM(CAST("${tableInfo.salesCol}" AS NUMERIC)) as revenue
                FROM "${tableInfo.tableName}"
                WHERE 1=1${dateWhere}
                GROUP BY month
                ORDER BY month DESC
                LIMIT $${dateParams.length + 1}
            `, [...dateParams, limit]);

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
