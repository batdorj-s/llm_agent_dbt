import { initDataLake, seedCsv } from "./src/db/data-lake.ts";

console.log("Seeding product_prices...");
const db = initDataLake();
seedCsv("product_prices.csv", "product_prices", "Admin", "Product price history source", true);
console.log("Seeding complete.");
