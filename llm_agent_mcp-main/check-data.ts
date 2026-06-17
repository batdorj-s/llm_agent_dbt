import { initDataLake } from "./src/db/data-lake.js";
const db = initDataLake();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
for (const table of tables) {
    if (table.name === 'sqlite_sequence') continue;
    const count = db.prepare(`SELECT COUNT(*) as count FROM "${table.name}"`).get();
    console.log(`Table: ${table.name}, Rows: ${count.count}`);
    const info = db.prepare(`PRAGMA table_info("${table.name}")`).all();
    console.log(`Columns: ${info.map(c => c.name).join(", ")}`);
    console.log("---");
}
