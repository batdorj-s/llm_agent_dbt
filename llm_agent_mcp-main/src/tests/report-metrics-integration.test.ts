import { describe, it, expect, beforeAll } from "vitest";
import { initDataLake, getPool, isPgAvailable } from "../db/data-lake.js";
import { computeMetrics } from "../agents/reportMetrics.js";

describe("computeMetrics — cross-tenant integration", () => {
    beforeAll(async () => {
        await initDataLake();
        if (process.env.CI && !isPgAvailable()) {
            throw new Error("PostgreSQL database is required for integration tests in CI.");
        }
    });

    it("CROSS-TENANT: each user sees only their own private table metrics", async () => {
        if (!isPgAvailable()) return;

        const suffix = Date.now();
        const tableA = `_test_cross_a_${suffix}`;
        const tableB = `_test_cross_b_${suffix}`;
        const userA = "cross_tenant_a";
        const userB = "cross_tenant_b";

        try {
            // Create both tables with same structure but different data
            await getPool().query(
                `CREATE TABLE "${tableA}" (id INT, amount NUMERIC, quantity INT, category TEXT, date TEXT)`
            );
            await getPool().query(
                `CREATE TABLE "${tableB}" (id INT, amount NUMERIC, quantity INT, category TEXT, date TEXT)`
            );

            // User A data: AOV = 100/2 = 50, category = Electronics
            await getPool().query(
                `INSERT INTO "${tableA}" (id, amount, quantity, category, date) VALUES
                 (1, 100, 2, 'Electronics', '2024-06-01'),
                 (2, 200, 3, 'Electronics', '2024-06-15')`
            );

            // User B data: AOV = 200/5 = 40, category = Clothing
            await getPool().query(
                `INSERT INTO "${tableB}" (id, amount, quantity, category, date) VALUES
                 (1, 200, 5, 'Clothing', '2024-06-01'),
                 (2, 300, 6, 'Clothing', '2024-06-15')`
            );

            // Register both tables in catalog with private visibility
            await getPool().query(
                `INSERT INTO data_lake_catalog
                 (table_name, created_by, owner_id, visibility, columns_info, description)
                 VALUES
                 ($1, $2, $2, 'private', '["id","amount","quantity","category","date"]', 'cross-tenant test A'),
                 ($3, $4, $4, 'private', '["id","amount","quantity","category","date"]', 'cross-tenant test B')
                 ON CONFLICT (table_name) DO UPDATE SET
                   owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility,
                   columns_info = EXCLUDED.columns_info`,
                [tableA, userA, tableB, userB]
            );

            // Register in uploaded_files so they're tracked as active
            await getPool().query(
                `INSERT INTO uploaded_files (id, filename, type, description, owner_id, visibility, created_at)
                 VALUES
                 ($1, $1, 'dataset', 'cross-tenant test A', $2, 'private', NOW()),
                 ($3, $3, 'dataset', 'cross-tenant test B', $4, 'private', NOW())
                 ON CONFLICT (id) DO UPDATE SET
                   owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility`,
                [tableA, userA, tableB, userB]
            );

            // Verify isolation: User A sees only A's data
            const metricsA = await computeMetrics(userA);
            expect(metricsA).not.toBeNull();
            expect(metricsA!.topCategory).toBe("Electronics");

            // Verify isolation: User B sees only B's data (not A's)
            const metricsB = await computeMetrics(userB);
            expect(metricsB).not.toBeNull();
            expect(metricsB!.topCategory).toBe("Clothing");
            expect(metricsB!.topCategory).not.toBe("Electronics");

            console.log(`[CROSS-TENANT] UserA topCategory='${metricsA!.topCategory}', UserB topCategory='${metricsB!.topCategory}' — isolated OK`);
        } finally {
            await getPool().query(`DROP TABLE IF EXISTS "${tableA}" CASCADE`).catch(() => {});
            await getPool().query(`DROP TABLE IF EXISTS "${tableB}" CASCADE`).catch(() => {});
            await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = ANY($1)`, [[tableA, tableB]]).catch(() => {});
            await getPool().query(`DELETE FROM uploaded_files WHERE id = ANY($1)`, [[tableA, tableB]]).catch(() => {});
        }
    });
});
