import { describe, it, expect, beforeAll } from "vitest";
import { initDataLake, getActiveCatalogEntry, getCatalog, ensureUploadedFilesSynced, isPgAvailable, getPool, executeSql } from "../db/data-lake.js";

describe("Data Lake — Active Catalog Entry", () => {
    const testUserId = "data_lake_test_user";

    beforeAll(async () => {
        await initDataLake();
        if (process.env.CI && !isPgAvailable()) {
            throw new Error("PostgreSQL database is required for database-backed tests in CI, but is not available.");
        }
    });

    it("BUG-SCENARIO: when uploaded_files is empty, falls back to catalog[0]", async () => {
        if (!isPgAvailable()) return;

        const catalog = await getCatalog("system");
        expect(catalog.length).toBeGreaterThan(0);

        const saved = await getPool().query(`SELECT id FROM uploaded_files WHERE type = 'dataset'`);
        const savedIds = saved.rows.map((r: any) => r.id);
        try {
            if (savedIds.length > 0) {
                await getPool().query(`DELETE FROM uploaded_files WHERE id = ANY($1)`, [savedIds]);
            }

            const activeEntry = await getActiveCatalogEntry("system");
            expect(activeEntry).not.toBeNull();
            expect(activeEntry!.table_name).toBe(catalog[0].table_name);
            console.log(`[TEST] BUG-SCENARIO: uploaded_files empty → catalog[0] = '${catalog[0].table_name}'`);
        } finally {
            for (const id of savedIds) {
                await getPool().query(
                    `INSERT INTO uploaded_files (id, filename, type, description, owner_id, visibility)
                     VALUES ($1, $1, 'dataset', 'restored', 'system', 'shared')
                     ON CONFLICT (id) DO NOTHING`,
                    [id]
                );
            }
        }
    });

    it("FIX-SCENARIO: user-uploaded table determines active entry (not catalog[0])", async () => {
        if (!isPgAvailable()) return;

        const testName = `_test_fix_scenario_${Date.now()}`;
        const userId = "fix_scenario_user";
        try {
            await getPool().query(`CREATE TABLE IF NOT EXISTS "${testName}" (id INT)`);
            await getPool().query(
                `INSERT INTO data_lake_catalog (table_name, created_by, owner_id, visibility, columns_info, description)
                 VALUES ($1, $2, $2, 'private', '["id"]', 'fix scenario test')
                 ON CONFLICT (table_name) DO UPDATE SET owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility`,
                [testName, userId]
            );

            await ensureUploadedFilesSynced();

            const catalog = await getCatalog(userId);
            const activeEntry = await getActiveCatalogEntry(userId);

            expect(activeEntry).not.toBeNull();
            expect(activeEntry!.table_name).toBe(testName);

            const isSameAsCatalogFirst = activeEntry!.table_name === catalog[0].table_name;
            console.log(`[TEST] FIX-SCENARIO: catalog[0]='${catalog[0].table_name}', activeEntry='${activeEntry!.table_name}', sameAsCatalogFirst=${isSameAsCatalogFirst}`);
        } finally {
            await getPool().query(`DROP TABLE IF EXISTS "${testName}" CASCADE`).catch(() => {});
            await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [testName]).catch(() => {});
            await getPool().query(`DELETE FROM uploaded_files WHERE id = $1`, [testName]).catch(() => {});
        }
    });

    it("NEW TABLE: uploading new table updates active entry (explicit tracking)", async () => {
        if (!isPgAvailable()) return;

        const testName = `_test_active_${Date.now()}`;
        let restoredPrev = "";
        try {
            const before = await getActiveCatalogEntry(testUserId);
            restoredPrev = before?.table_name || "";

            await getPool().query(`CREATE TABLE IF NOT EXISTS "${testName}" (id INT)`);
            await getPool().query(
                `INSERT INTO data_lake_catalog (table_name, created_by, owner_id, visibility, columns_info, description)
                 VALUES ($1, 'test', $2, 'private', '["id"]', 'test active entry')
                 ON CONFLICT (table_name) DO UPDATE SET owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, columns_info = '["id"]'`,
                [testName, testUserId]
            );
            await getPool().query(
                `INSERT INTO uploaded_files (id, filename, type, description, owner_id, visibility, created_at)
                 VALUES ($1, $1, 'dataset', 'test active entry', $2, 'private', NOW())
                 ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, created_at = EXCLUDED.created_at`,
                [testName, testUserId]
            );

            const afterEntry = await getActiveCatalogEntry(testUserId);
            expect(afterEntry).not.toBeNull();
            expect(afterEntry!.table_name).toBe(testName);
            const otherUserEntry = await getActiveCatalogEntry("different_user");
            expect(otherUserEntry?.table_name).not.toBe(testName);
            console.log(`[TEST] NEW TABLE: active entry changed from '${restoredPrev}' to '${testName}'`);
        } finally {
            try {
                await getPool().query(`DROP TABLE IF EXISTS "${testName}" CASCADE`);
                await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [testName]);
                await getPool().query(`DELETE FROM uploaded_files WHERE id = $1`, [testName]);
            } catch {}
        }
    });

    it("SECURITY: private SQL tables are isolated by owner_id", async () => {
        if (!isPgAvailable()) return;

        const suffix = Date.now();
        const tableA = `_test_tenant_a_${suffix}`;
        const tableB = `_test_tenant_b_${suffix}`;
        const userA = "tenant_a";
        const userB = "tenant_b";

        try {
            await getPool().query(`CREATE TABLE "${tableA}" (id INT, secret TEXT)`);
            await getPool().query(`CREATE TABLE "${tableB}" (id INT, secret TEXT)`);
            await getPool().query(`INSERT INTO "${tableA}" (id, secret) VALUES (1, 'alpha')`);
            await getPool().query(`INSERT INTO "${tableB}" (id, secret) VALUES (1, 'bravo')`);

            await getPool().query(
                `INSERT INTO data_lake_catalog (table_name, created_by, owner_id, visibility, columns_info, description)
                 VALUES ($1, $2, $2, 'private', '["id","secret"]', 'tenant isolation test'),
                        ($3, $4, $4, 'private', '["id","secret"]', 'tenant isolation test')
                 ON CONFLICT (table_name) DO UPDATE SET owner_id = EXCLUDED.owner_id, visibility = EXCLUDED.visibility, columns_info = EXCLUDED.columns_info`,
                [tableA, userA, tableB, userB]
            );

            const ownRows = await executeSql(`SELECT secret FROM "${tableA}"`, true, userA);
            expect(ownRows).toEqual([{ secret: "alpha" }]);

            await expect(executeSql(`SELECT secret FROM "${tableB}"`, true, userA))
                .rejects
                .toThrow(/Хүснэгт .* байхгүй|Catalog is empty/);
        } finally {
            await getPool().query(`DROP TABLE IF EXISTS "${tableA}" CASCADE`);
            await getPool().query(`DROP TABLE IF EXISTS "${tableB}" CASCADE`);
            await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = ANY($1)`, [[tableA, tableB]]);
            await getPool().query(`DELETE FROM uploaded_files WHERE id = ANY($1)`, [[tableA, tableB]]);
        }
    });

    it("active entry has valid columns_info", async () => {
        if (!isPgAvailable()) return;

        const activeEntry = await getActiveCatalogEntry("system");
        expect(activeEntry).not.toBeNull();

        const cols: string[] = JSON.parse(activeEntry!.columns_info);
        expect(Array.isArray(cols)).toBe(true);
        expect(cols.length).toBeGreaterThan(0);
    });
});
