import { initDataLake, getPool } from "./src/db/data-lake.js";

async function main() {
    await initDataLake();
    const tablesResult = await getPool().query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
    );
    for (const table of tablesResult.rows) {
        if (table.table_name === 'data_lake_catalog' || table.table_name === 'uploaded_files' || table.table_name === 'kpi_targets') continue;
        const countResult = await getPool().query(`SELECT COUNT(*) as count FROM "${table.table_name}"`);
        console.log(`Table: ${table.table_name}, Rows: ${countResult.rows[0].count}`);
        const colResult = await getPool().query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
            [table.table_name]
        );
        console.log(`Columns: ${colResult.rows.map(c => c.column_name).join(", ")}`);
        console.log("---");
    }
}

main().catch(console.error);
