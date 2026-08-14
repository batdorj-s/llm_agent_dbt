import type { IKpiRepository, KpiMetric, SalesRecord, DateFilter } from "./types.js";
import { initDataLake, getPool } from "./data-lake.js";
import { getActiveTableInfo as resolveActiveTable, isNumericType } from "./active-table.js";

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

// Орлогын категориудыг шүүх нөхцөл (category column байвал)
// LOWER() does not fold Mongolian Cyrillic in C/POSIX locale — match both forms explicitly
function incomeFilter(categoryCol: string | undefined): string {
    if (!categoryCol) return "";
    return ` AND ("${categoryCol}" LIKE '%Орлого%' OR "${categoryCol}" LIKE '%орлого%' OR "${categoryCol}" LIKE '%ОРЛОГО%')`;
}

// Зарлагын категориудыг шүүх нөхцөл
function _expenseFilter(categoryCol: string | undefined): string {
    if (!categoryCol) return "";
    return ` AND ("${categoryCol}" LIKE '%Зарлага%' OR "${categoryCol}" LIKE '%зарлага%' OR "${categoryCol}" LIKE '%ЗАРЛАГА%')`;
}

export class SQLiteKpiRepository implements IKpiRepository {
    constructor() {}

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
            const cat = tableInfo.categoryCol;

            if (metric === "sales") {
                // Зөвхөн орлогын гүйлгээний нийлбэр
                const result = await getPool().query(
                    `SELECT COALESCE(SUM(CAST("${tableInfo.salesCol}" AS NUMERIC)), 0) as total
                     FROM "${tableInfo.tableName}"
                     WHERE 1=1${dateWhere}${incomeFilter(cat)}`,
                    dateParams
                );
                current = Number(result.rows[0]?.total || 0);
            } else if (metric === "users") {
                // Орлогын гүйлгээн дэх өвөрмөц харилцагчид
                const result = await getPool().query(
                    `SELECT COUNT(DISTINCT "${tableInfo.userCol}") as count
                     FROM "${tableInfo.tableName}"
                     WHERE 1=1${dateWhere}${incomeFilter(cat)}`,
                    dateParams
                );
                current = Number(result.rows[0]?.count || 0);
            } else if (metric === "churn_rate") {
                if (cat) {
                    // Зарлага / Орлого харьцаа (%)
                    const result = await getPool().query(
                        `SELECT
                           COALESCE(
                             SUM(CASE WHEN ("${cat}" LIKE '%Зарлага%' OR "${cat}" LIKE '%зарлага%' OR "${cat}" LIKE '%ЗАРЛАГА%')
                                 THEN CAST("${tableInfo.salesCol}" AS NUMERIC) ELSE 0 END) * 100.0
                             / NULLIF(
                                 SUM(CASE WHEN ("${cat}" LIKE '%Орлого%' OR "${cat}" LIKE '%орлого%' OR "${cat}" LIKE '%ОРЛОГО%')
                                     THEN CAST("${tableInfo.salesCol}" AS NUMERIC) ELSE 0 END),
                               0),
                           0) as rate
                         FROM "${tableInfo.tableName}"
                         WHERE 1=1${dateWhere}`,
                        dateParams
                    );
                    current = Number(result.rows[0]?.rate || 0);
                } else {
                    const result = await getPool().query(
                        `SELECT COUNT(*) FILTER (WHERE "${tableInfo.dateCol}" IS NULL) * 100.0
                           / NULLIF(COUNT(*), 0) as rate
                         FROM "${tableInfo.tableName}"
                         WHERE 1=1${dateWhere}`,
                        dateParams
                    );
                    current = Number(result.rows[0]?.rate || 0);
                }
            }

            return {
                name: metric,
                current: Math.round(current * 100) / 100,
                target: targetRow.target_value,
                unit: targetRow.unit,
                updatedAt: new Date().toISOString()
            };
        } catch {
            return null;
        }
    }

    private async getActiveTableInfo(userId?: string): Promise<{
        tableName: string;
        salesCol: string;
        userCol: string;
        dateCol: string;
        categoryCol?: string;
    } | null> {
        // Column-role detection over the shared active-table resolution
        // (single source of truth lives in active-table.ts).
        return resolveActiveTable(userId, (info) => {
            const { columns, columnTypes } = info;
            const salesCol = columns.find(c => /amount|sales|revenue|price/i.test(c))
                || columns.find(c => /total|income|spend|value|cost|profit/i.test(c))
                || columns.find(c => isNumericType(columnTypes, c))
                || null;
            if (!salesCol) return false;

            const userCol = columns.find(c => /customer_id|user_id|_id/i.test(c))
                || columns.find(c => /customer|client|user|member|account/i.test(c))
                || null;
            if (!userCol) return false;

            const dateCol = columns.find(c => /date|time/i.test(c))
                || columns.find(c => /timestamp/i.test(c))
                || columns.find(c => /year|month|day/i.test(c))
                || null;
            if (!dateCol) return false;

            return true;
        }).then((info) => {
            if (!info) return null;
            const { columns, columnTypes } = info;
            const salesCol = columns.find(c => /amount|sales|revenue|price/i.test(c))
                || columns.find(c => /total|income|spend|value|cost|profit/i.test(c))
                || columns.find(c => isNumericType(columnTypes, c))
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
            const categoryCol = columns.find(c => /^category$/i.test(c))
                || columns.find(c => /category|type|kind|class/i.test(c))
                || undefined;
            return { tableName: info.tableName, salesCol, userCol, dateCol, categoryCol };
        });
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
            const cat = tableInfo.categoryCol;

            const rows = await getPool().query(`
                SELECT
                    TO_CHAR(REPLACE("${tableInfo.dateCol}", '.', '-')::timestamp, 'YYYY-MM') as month,
                    SUM(CAST("${tableInfo.salesCol}" AS NUMERIC)) as revenue
                FROM "${tableInfo.tableName}"
                WHERE 1=1${dateWhere}${incomeFilter(cat)}
                GROUP BY month
                ORDER BY month DESC
                LIMIT $${dateParams.length + 1}
            `, [...dateParams, limit]);

            const monthNames = ["1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар",
                                "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар"];

            return [...rows.rows].reverse().map(row => {
                if (!row.month) return { month: "Тодорхойгүй", revenue: row.revenue };
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
