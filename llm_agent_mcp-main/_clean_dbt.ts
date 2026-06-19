import Database from "better-sqlite3";
const db = new Database("datalake.db");
const names = ["stg_sales", "int_sales_enriched", "kpi_sales", "user_metrics", "my_first_dbt_model"];
for (const name of names) {
  for (const cmd of ["DROP VIEW IF EXISTS", "DROP TABLE IF EXISTS"]) {
    try { db.exec(`${cmd} "${name}"`); } catch {}
    try { db.exec(`${cmd} ${name}`); } catch {}
    try { db.exec(`${cmd} main."${name}"`); } catch {}
  }
}
const rows = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
console.log("Remaining:", rows.map((r: any) => `${r.name} (${r.type})`).join(", "));
