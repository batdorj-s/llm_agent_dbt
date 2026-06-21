import { describe, it, expect, beforeAll } from "vitest";
import { initDataLake, getActiveCatalogEntry, getCatalog, ensureUploadedFilesSynced, isPgAvailable, getPool } from "../db/data-lake.js";

describe("Data Lake — Active Catalog Entry", () => {
    beforeAll(async () => {
        await initDataLake();
    });

    it("BUG-SCENARIO: when uploaded_files is empty, falls back to catalog[0]", async () => {
        if (!isPgAvailable()) return;

        const catalog = await getCatalog();
        expect(catalog.length).toBeGreaterThan(0);

        const saved = await getPool().query(`SELECT id FROM uploaded_files WHERE type = 'dataset'`);
        const savedIds = saved.rows.map((r: any) => r.id);
        try {
            if (savedIds.length > 0) {
                await getPool().query(`DELETE FROM uploaded_files WHERE id = ANY($1)`, [savedIds]);
            }

            const activeEntry = await getActiveCatalogEntry();
            expect(activeEntry).not.toBeNull();
            expect(activeEntry!.table_name).toBe(catalog[0].table_name);
            console.log(`[TEST] BUG-SCENARIO: uploaded_files empty → catalog[0] = '${catalog[0].table_name}'`);
        } finally {
            for (const id of savedIds) {
                await getPool().query(
                    `INSERT INTO uploaded_files (id, filename, type, description) VALUES ($1, $1, 'dataset', 'restored') ON CONFLICT DO NOTHING`,
                    [id]
                );
            }
            await ensureUploadedFilesSynced();
        }
    });

    it("FIX-SCENARIO: when uploaded_files is populated, returns explicit entry (not catalog[0])", async () => {
        if (!isPgAvailable()) return;

        await ensureUploadedFilesSynced();
        const catalog = await getCatalog();
        const activeEntry = await getActiveCatalogEntry();

        expect(activeEntry).not.toBeNull();

        const uploadedFiles = await getPool().query(
            `SELECT id FROM uploaded_files WHERE type = 'dataset' ORDER BY created_at DESC LIMIT 1`
        );
        const mostRecentUploadedId = uploadedFiles.rows[0]?.id;
        expect(mostRecentUploadedId).toBeTruthy();
        expect(activeEntry!.table_name).toBe(mostRecentUploadedId);

        const isSameAsCatalogFirst = activeEntry!.table_name === catalog[0].table_name;
        console.log(`[TEST] FIX-SCENARIO: catalog[0]='${catalog[0].table_name}', activeEntry='${activeEntry!.table_name}', sameAsCatalogFirst=${isSameAsCatalogFirst}`);
    });

    it("NEW TABLE: uploading new table updates active entry (explicit tracking)", async () => {
        if (!isPgAvailable()) return;

        const testName = `_test_active_${Date.now()}`;
        let restoredPrev = "";
        try {
            const before = await getActiveCatalogEntry();
            restoredPrev = before?.table_name || "";

            await getPool().query(`CREATE TABLE IF NOT EXISTS "${testName}" (id INT)`);
            await getPool().query(
                `INSERT INTO data_lake_catalog (table_name, created_by, columns_info, description)
                 VALUES ($1, 'test', '["id"]', 'test active entry')
                 ON CONFLICT (table_name) DO UPDATE SET columns_info = '["id"]'`,
                [testName]
            );
            await getPool().query(
                `INSERT INTO uploaded_files (id, filename, type, description, created_at)
                 VALUES ($1, $1, 'dataset', 'test active entry', NOW())
                 ON CONFLICT (id) DO NOTHING`,
                [testName]
            );

            const afterEntry = await getActiveCatalogEntry();
            expect(afterEntry).not.toBeNull();
            expect(afterEntry!.table_name).toBe(testName);
            console.log(`[TEST] NEW TABLE: active entry changed from '${restoredPrev}' to '${testName}'`);
        } finally {
            try {
                await getPool().query(`DROP TABLE IF EXISTS "${testName}" CASCADE`);
                await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [testName]);
                await getPool().query(`DELETE FROM uploaded_files WHERE id = $1`, [testName]);
            } catch {}
        }
    });

    it("active entry has valid columns_info", async () => {
        if (!isPgAvailable()) return;

        const activeEntry = await getActiveCatalogEntry();
        expect(activeEntry).not.toBeNull();

        const cols: string[] = JSON.parse(activeEntry!.columns_info);
        expect(Array.isArray(cols)).toBe(true);
        expect(cols.length).toBeGreaterThan(0);
    });
});
