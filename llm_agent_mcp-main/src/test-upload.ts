import { seedCsv, getCatalog, initDataLake } from "./db/data-lake.js";
import { addDocumentToCatalog, mockDocuments } from "./rag.js";
import fs from "fs";
import path from "path";

async function runTest() {
  console.log("=== Testing Dynamic CSV Upload Logic ===");

  const testTableName = "test_upload_table";
  const testCsvPath = path.join(process.cwd(), "test_upload.csv");
  const testCsvContent = `Order Date,Sales,Category\n2015.10.12,5000,Technology\n2015.10.15,7500,Furniture`;

  try {
    // 1. Write file
    fs.writeFileSync(testCsvPath, testCsvContent, "utf8");
    console.log("1. Created test CSV file ✅");

    // 2. Initialize DB & Seed
    initDataLake();
    seedCsv(testCsvPath, testTableName, "TestAdmin", "Dynamic test dataset");
    console.log("2. Seeded CSV to SQLite ✅");

    // 3. Verify Catalog
    const catalog = getCatalog();
    const tableInfo = catalog.find((row: any) => row.table_name === testTableName) as any;
    if (!tableInfo) {
      throw new Error("Table not found in Data Lake Catalog!");
    }
    console.log("3. Verified Catalog Entry ✅");
    console.log("   Columns:", tableInfo.columns_info);

    // 4. Index in RAG
    const cols = JSON.parse(tableInfo.columns_info);
    const formattedCols = cols.map((c: string) => `\`${c}\``).join(", ");
    const ragText = `Data Lake Catalog: The table '${testTableName}' is loaded. Columns: ${formattedCols}. Description: Dynamic test dataset.`;

    await addDocumentToCatalog(
      `test_upload_doc_${Date.now()}`,
      ragText,
      { category: "catalog", department: "analytics", uploadedBy: "TestAdmin" },
      [testTableName, "catalog", "sqlite"]
    );
    console.log("4. Indexed in RAG ✅");

    // 5. Verify RAG In-Memory Store
    const found = mockDocuments.some((doc: { text: string }) => doc.text.includes(testTableName));
    if (!found) {
      throw new Error("Document not found in mockDocuments!");
    }
    console.log("5. Verified Document in RAG memory ✅");
    console.log("=== All Upload Tests Passed successfully! ===");
  } catch (err: any) {
    console.error("❌ Test Failed:", err.message);
  } finally {
    if (fs.existsSync(testCsvPath)) {
      fs.unlinkSync(testCsvPath);
    }
  }
}

runTest();
