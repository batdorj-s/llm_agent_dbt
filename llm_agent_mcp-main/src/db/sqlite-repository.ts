import { IKpiRepository, KpiMetric, SalesRecord } from "./types.js";
import { executeSql, initDataLake } from "./data-lake.js";
import Database from "better-sqlite3";
import path from "path";

export class SQLiteKpiRepository implements IKpiRepository {
    private db: Database.Database;

    constructor() {
        this.db = initDataLake();
        this.initTargetsTable();
    }

    private initTargetsTable() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS kpi_targets (
                metric_name TEXT PRIMARY KEY,
                target_value REAL,
                unit TEXT
            )
        `);

        // Seed default targets if missing
        const seed = this.db.prepare(`INSERT OR IGNORE INTO kpi_targets (metric_name, target_value, unit) VALUES (?, ?, ?)`);
        seed.run("sales", 500000, "USD");
        seed.run("users", 2000, "users");
        seed.run("churn_rate", 2.0, "%");
    }

    private async getActiveTableInfo() {
        const catalog = this.db.prepare(`SELECT * FROM data_lake_catalog ORDER BY created_at DESC LIMIT 1`).get() as any;
        if (!catalog) return null;

        const columns = JSON.parse(catalog.columns_info) as string[];
        
        // Find best column for Sales (contains 'amount', 'sales', 'revenue', 'price')
        const salesCol = columns.find(c => /amount|sales|revenue|price/i.test(c)) || columns[columns.length - 1];
        
        // Find best column for Users (contains 'id', 'customer', 'user')
        const userCol = columns.find(c => /customer_id|user_id|id/i.test(c)) || columns[0];

        // Find best column for Date (contains 'date', 'time')
        const dateCol = columns.find(c => /date|time/i.test(c)) || columns.find(c => columns.indexOf(c) === 1) || "Date";

        return {
            tableName: catalog.table_name,
            salesCol,
            userCol,
            dateCol
        };
    }

    async getKpi(metric: KpiMetric["name"]): Promise<KpiMetric | null> {
        try {
            const targetRow = this.db.prepare(`SELECT target_value, unit FROM kpi_targets WHERE metric_name = ?`).get(metric) as any;
            if (!targetRow) return null;

            let current = 0;
            if (metric === "sales") {
                // Using dbt kpi_sales view
                const result = this.db.prepare(`SELECT SUM(total_sales) as total FROM kpi_sales`).get() as any;
                current = result?.total || 0;
            } else if (metric === "users") {
                // Using dbt user_metrics view
                const result = this.db.prepare(`SELECT COUNT(DISTINCT customer_id) as count FROM user_metrics`).get() as any;
                current = result?.count || 0;
            } else if (metric === "churn_rate") {
                // Using dbt user_metrics for reliable calculation: customers with only 1 order
                const result = this.db.prepare(`
                    SELECT 
                        (SELECT COUNT(*) FROM user_metrics WHERE total_orders = 1) * 100.0 / 
                        (SELECT COUNT(*) FROM user_metrics) as rate
                `).get() as any;
                current = result?.rate || 0;
            }

            return {
                name: metric,
                current: Math.round(current * 100) / 100,
                target: targetRow.target_value,
                unit: targetRow.unit,
                updatedAt: new Date().toISOString()
            };
        } catch (err) {
            console.warn(`[DB] dbt views not found or error, falling back to basic logic for KPI ${metric}`);
            // Fallback logic if dbt models aren't built yet
            return this.getKpiFallback(metric);
        }
    }

    private async getKpiFallback(metric: KpiMetric["name"]): Promise<KpiMetric | null> {
        try {
            const tableInfo = await this.getActiveTableInfo();
            if (!tableInfo) return null;

            let current = 0;
            const targetRow = this.db.prepare(`SELECT target_value, unit FROM kpi_targets WHERE metric_name = ?`).get(metric) as any;
            if (!targetRow) return null;

            if (metric === "sales") {
                const result = this.db.prepare(`SELECT SUM(CAST(${tableInfo.salesCol} AS REAL)) as total FROM ${tableInfo.tableName}`).get() as any;
                current = result?.total || 0;
            } else if (metric === "users") {
                const result = this.db.prepare(`SELECT COUNT(DISTINCT ${tableInfo.userCol}) as count FROM ${tableInfo.tableName}`).get() as any;
                current = result?.count || 0;
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

    async getSalesHistory(limit: number): Promise<SalesRecord[]> {
        try {
            // Using dbt kpi_sales view
            const rows = this.db.prepare(`
                SELECT 
                    strftime('%Y-%m', order_date) as month,
                    SUM(total_sales) as revenue
                FROM kpi_sales
                GROUP BY month
                ORDER BY month DESC
                LIMIT ?
            `).all(limit) as any[];

            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

            return rows.reverse().map(row => {
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

            const rows = this.db.prepare(`
                SELECT 
                    strftime('%Y-%m', REPLACE(${tableInfo.dateCol}, '.', '-')) as month,
                    SUM(CAST(${tableInfo.salesCol} AS REAL)) as revenue
                FROM ${tableInfo.tableName}
                GROUP BY month
                ORDER BY month DESC
                LIMIT ?
            `).all(limit) as any[];

            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

            return rows.reverse().map(row => {
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
        this.db.prepare(`UPDATE kpi_targets SET target_value = ? WHERE metric_name = ?`).run(target, metric);
    }
}
