import { initDataLake, seedCsv } from "./src/db/data-lake.ts";

async function main() {
    console.log("Seeding product_prices...");
    await initDataLake();
    await seedCsv("product_prices.csv", "product_prices", "Admin", "Product price history source", true);
    console.log("Seeding complete.");
}

main().catch(console.error);
