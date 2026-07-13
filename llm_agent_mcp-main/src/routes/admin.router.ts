import { Router } from "express";
import { requireAuth } from "../auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { getUserId, getRole, log } from "./shared.js";
import { uploadLimiter } from "../rate-limiter.js";
import {
  initDataLake, getPool, getCatalog, seedCsv, getActiveCatalogEntry,
  getColumnSamples, getColumnProfile, computeTableKpis, detectForeignKeys,
  quoteIdent, mergeIntoCombined,
} from "../db/data-lake.js";
import { removeDocumentsByPrefix, addDocumentToCatalog } from "../rag.js";
import { clearConversationMemory } from "../multi-agent.js";
import { findConceptColumn } from "../agents/columnSynonyms.js";
import { buildSemanticGroups } from "../utils.js";
import { runDbtForTable, runDbtTest, runDbtFinanceModels } from "../setup/init.js";
import { generateSchemaYml } from "../setup/generate-schema.js";
import { generateDataPassport } from "../agents/dataProfiler.js";
import fs from "fs";
import path from "path";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { upload } from "./shared.js";

const router = Router();

const DOCUMENTS_DIR = "uploads/documents/";
if (!fs.existsSync(DOCUMENTS_DIR)) {
  fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
}

interface DbFileRow {
  id: string;
  type: string;
  filename: string;
  description?: string;
  created_at?: string;
  [key: string]: unknown;
}

// ── Shared post-seed logic ────────────────────────────────────
function buildColumnMapping(cols: string[]): Record<string, string | null> {
  return {
    sales_col: cols.find(c => /sales|revenue|amount|price/i.test(c)) || null,
    date_col: cols.find(c => /date|time|timestamp|month|year|day/i.test(c)) || null,
    customer_col: cols.find(c => /customer_id|user_id|client_id|account_id|email/i.test(c)) || null,
    segment_col: cols.find(c => /segment|group|type|class|tier|bucket/i.test(c)) || null,
    category_col: cols.find(c => /category|product|item|brand|department|sub_category/i.test(c)) || null,
    profit_col: cols.find(c => /profit|margin|cogs/i.test(c)) || null,
    id_col: cols.find(c => /_id$|^id$|order_id|transaction|invoice/i.test(c)) || null,
    region_col: cols.find(c => /region|city|state|country|area|location|market/i.test(c)) || null,
  };
}

async function processUploadedTable(
    sanitizedTableName: string,
    description: string,
    userId: string,
    originalFilename: string,
): Promise<{
    preview: Record<string, unknown>[];
    columns: string[];
    dbtStatus: string;
}> {
    const catalog = await getCatalog(userId);
    const tableInfo = catalog.find((row: Record<string, unknown>) => row.table_name === sanitizedTableName) as { table_name: string; columns_info: string; [key: string]: unknown } | undefined;

    let cols: string[] = [];
    if (tableInfo) {
        cols = JSON.parse(tableInfo.columns_info) as string[];

        await removeDocumentsByPrefix(`uploaded_${sanitizedTableName}_`);

        const [samples, profile] = await Promise.all([
            getColumnSamples(sanitizedTableName, cols, 5),
            getColumnProfile(sanitizedTableName, cols),
        ]);

        await getPool().query(
            `UPDATE data_lake_catalog SET column_profiles = $1 WHERE table_name = $2`,
            [JSON.stringify(profile), sanitizedTableName]
        );

        const sampleText = cols.map(c => {
            const p = profile[c];
            const typeLabel = p?.type ? (p.type === "integer" ? "INT" : p.type === "numeric" ? "DEC" : p.type) : "TEXT";
            const rangeInfo = p?.min !== undefined && p?.max !== undefined ? ` [${p.min}..${p.max}]` : "";
            const vals = samples[c];
            return vals && vals.length > 0 ? `"${c}" (${typeLabel}${rangeInfo}, e.g. ${vals.join(", ")})` : `"${c}" (${typeLabel}${rangeInfo})`;
        }).join(", ");
        const ragText = `Data Lake Catalog: The table '${sanitizedTableName}' is loaded into a PostgreSQL database. Columns: ${sampleText}. Description: ${description}. Use this table for SQL queries. Table name: "${sanitizedTableName}".`;
        await addDocumentToCatalog(`uploaded_${sanitizedTableName}_${Date.now()}`, ragText, {
            category: "data_catalog",
            department: "analytics",
            author: userId || "unknown",
            source_name: `Upload: ${sanitizedTableName}`,
            shared: true,
        }, [sanitizedTableName]);

        const kpiLines = await computeTableKpis(sanitizedTableName, cols, profile);
        for (let i = 0; i < kpiLines.length; i++) {
            await addDocumentToCatalog(`kpi_${sanitizedTableName}_${i}`, kpiLines[i], {
                category: "business_policy",
                department: "analytics",
                author: userId || "unknown",
                source_name: `Auto-KPI: ${sanitizedTableName}`,
            }, [sanitizedTableName, "kpi", `kpi_${i}`]);
        }
        if (kpiLines.length > 0) {
            console.log(`[Upload] Auto-computed ${kpiLines.length} KPIs for '${sanitizedTableName}'`);
        }

        if (cols.length > 0) {
            try {
                const previewResult = await getPool().query(`SELECT * FROM ${quoteIdent(sanitizedTableName)} LIMIT 10`);
                const sampleRows = previewResult.rows as Record<string, unknown>[];
                generateDataPassport(sanitizedTableName, cols, sampleRows, description).catch(err =>
                    console.warn(`[Upload] Data passport generation failed (non-fatal):`, (err as Error).message)
                );
            } catch (previewErr) {
                console.warn(`[Upload] Data passport sample fetch failed:`, (previewErr as Error).message);
            }
        }
    }

    const semanticGroups = buildSemanticGroups(cols);
    await getPool().query(
        `INSERT INTO uploaded_files (id, filename, type, description, semantic_groups, generated_at, owner_id, visibility) VALUES ($1, $2, $3, $4, $5, $6, $7, 'private')
         ON CONFLICT (id) DO UPDATE SET filename=EXCLUDED.filename, type=EXCLUDED.type, description=EXCLUDED.description, semantic_groups=EXCLUDED.semantic_groups, generated_at=EXCLUDED.generated_at, owner_id=EXCLUDED.owner_id, visibility=EXCLUDED.visibility`,
        [sanitizedTableName, originalFilename, "dataset", description, JSON.stringify(semanticGroups), new Date().toISOString(), userId]
    );

    await clearConversationMemory();

    if (cols.length > 0) {
        await detectForeignKeys(sanitizedTableName, cols).catch(err =>
            console.warn("[Upload] FK detection failed:", (err as Error).message)
        );
    }

    let dbtStatus = "skipped";
    const isFinanceTable = !!findConceptColumn(cols, "finance_amount", sanitizedTableName)
        && !!findConceptColumn(cols, "finance_category", sanitizedTableName);
    const isSalesTable = !isFinanceTable
        && cols.some((c: string) => /sales|revenue|amount/i.test(c))
        && cols.some((c: string) => /customer_id|user_id|_id/i.test(c));

    if (isFinanceTable) {
        try {
            runDbtFinanceModels(sanitizedTableName);
            dbtStatus = "ok";
        } catch (err) {
            dbtStatus = "error";
            const errMsg = (err as Error).message;
            console.warn(`[Upload] Finance dbt pipeline error for '${sanitizedTableName}':`, errMsg);
            const warningText = `[АНХААР] FINANCE PIPELINE WARNING for table '${sanitizedTableName}': dbt finance models failed to run. Dashboard charts may be empty. Error: ${errMsg}`;
            await addDocumentToCatalog(`dbt_warning_${sanitizedTableName}`, warningText, {
                category: "data_catalog",
                department: "analytics",
                author: "system",
                source_name: "Finance Pipeline Gate",
            }, [sanitizedTableName, "dbt_warning", "finance", "data_quality"]).catch(() => {});
        }
    } else if (isSalesTable) {
        const mapping = buildColumnMapping(cols);
        try {
            runDbtForTable(sanitizedTableName, cols, mapping);
            await generateSchemaYml(sanitizedTableName, cols);
            const testOutput = runDbtTest(JSON.stringify({ input_table: sanitizedTableName, ...mapping }));
            const hasFailures = /FAILED|ERROR/i.test(testOutput);
            if (hasFailures) {
                dbtStatus = "tests_failed";
                const warningText = `[АНХААР] DATA QUALITY WARNING for table '${sanitizedTableName}': dbt tests detected issues. Agents should verify data before reporting.`;
                await addDocumentToCatalog(`dbt_warning_${sanitizedTableName}`, warningText, {
                    category: "data_catalog",
                    department: "analytics",
                    author: "system",
                    source_name: "Data Quality Gate",
                }, [sanitizedTableName, "dbt_warning", "data_quality"]);
                console.warn(`[Upload] dbt tests FAILED for '${sanitizedTableName}' — RAG warning added`);
            } else {
                dbtStatus = "ok";
                console.log(`[Upload] dbt tests PASSED for '${sanitizedTableName}' [OK]`);
            }
        } catch (err) {
            dbtStatus = "error";
            console.warn(`[Upload] dbt pipeline error for '${sanitizedTableName}':`, (err as Error).message);
        }
    }

    let preview: Record<string, unknown>[] = [];
    try {
        const previewResult = await getPool().query(`SELECT * FROM "${sanitizedTableName}" LIMIT 20`);
        preview = previewResult.rows;
    } catch (previewErr) {
        console.warn("[Upload] Preview fetch failed:", (previewErr as Error).message);
    }

    return {
        preview,
        columns: cols.length > 0 ? cols : (preview.length > 0 ? Object.keys(preview[0]) : []),
        dbtStatus,
    };
}

// ── File Management ──────────────────────────────────────────
router.get("/admin/files", requireAuth, requirePermission("admin:upload"), async (req, res) => {
  await initDataLake();
  const result = await getPool().query(`SELECT * FROM uploaded_files ORDER BY created_at DESC`);
  res.json(result.rows);
});

router.delete("/admin/files/:id", requireAuth, requirePermission("admin:upload"), async (req, res) => {
  const { id } = req.params;
  await initDataLake();

  const fileResult = await getPool().query(`SELECT * FROM uploaded_files WHERE id = $1`, [id]);
  const file = fileResult.rows[0] as DbFileRow | undefined;
  if (!file) return res.status(404).json({ error: "File not found" });

  try {
    if (file.type === "dataset") {
      const tableName = file.id || file.filename;
      await getPool().query(`DROP TABLE IF EXISTS ${quoteIdent(tableName)} CASCADE`);
      await getPool().query(`DELETE FROM data_lake_catalog WHERE table_name = $1`, [tableName]);
      await removeDocumentsByPrefix(`uploaded_${tableName}_`);
      await removeDocumentsByPrefix(`dbt_warning_${tableName}`);
      await clearConversationMemory();
    }
    if (file.type === "document") {
      const safeFilename = `${id}_${(file.filename as string).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      try { fs.unlinkSync(path.join(DOCUMENTS_DIR, safeFilename)); } catch (e) { console.warn("[file-cleanup]", e instanceof Error ? e.message : e); }
      try { fs.unlinkSync(path.join(DOCUMENTS_DIR, `${id}.txt`)); } catch (e) { console.warn("[file-cleanup]", e instanceof Error ? e.message : e); }
      await removeDocumentsByPrefix(`${id}_`);
      await clearConversationMemory();
    }
    await getPool().query(`DELETE FROM uploaded_files WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/admin/files/:id/preview", requireAuth, requirePermission("admin:upload"), async (req, res) => {
  const { id } = req.params;
  await initDataLake();

  try {
    const fileResult = await getPool().query(`SELECT * FROM uploaded_files WHERE id = $1`, [id]);
    const file = fileResult.rows[0] as DbFileRow | undefined;
    if (!file) return res.status(404).json({ error: "File not found" });

    if (file.type === "dataset") {
      const tableName = file.id || file.filename;
      const previewResult = await getPool().query(`SELECT * FROM ${quoteIdent(tableName)} LIMIT 20`);
      let columns: string[] = [];
      try {
        const catalogResult = await getPool().query(
          `SELECT columns_info FROM data_lake_catalog WHERE table_name = $1`, [tableName]
        );
        if (catalogResult.rows.length > 0) {
          columns = JSON.parse(catalogResult.rows[0].columns_info as string);
        }
      } catch (e) {
        console.error("[API] Failed to parse columns_info for preview:", e);
      }
      if (columns.length === 0 && previewResult.rows.length > 0) {
        columns = Object.keys(previewResult.rows[0]);
      }
      return res.json({ type: "dataset", preview: previewResult.rows, columns, tableName });
    }

    const textPath = path.join(DOCUMENTS_DIR, `${id}.txt`);
    let content = "";
    if (fs.existsSync(textPath)) {
      content = fs.readFileSync(textPath, "utf8");
    }

    return res.json({
      type: "document",
      preview: [],
      columns: [],
      tableName: file.id || file.filename,
      description: file.description || "No description",
      content: content.substring(0, 10000),
      hasDownload: fs.existsSync(path.join(DOCUMENTS_DIR, `${id}_${file.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`)),
    });
  } catch (err: unknown) {
    console.error(`[API] Preview failed for file ${id}:`, err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Preview failed" });
  }
});

router.get("/admin/files/:id/download", requireAuth, requirePermission("admin:upload"), async (req, res) => {
  const { id } = req.params;
  await initDataLake();

  try {
    const fileResult = await getPool().query(`SELECT * FROM uploaded_files WHERE id = $1`, [id]);
    const file = fileResult.rows[0] as DbFileRow | undefined;
    if (!file) return res.status(404).json({ error: "File not found" });
    if (file.type !== "document") return res.status(400).json({ error: "Only documents can be downloaded" });

    const safeFilename = `${id}_${file.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(DOCUMENTS_DIR, safeFilename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not available" });

    res.download(filePath, file.filename);
  } catch (err: unknown) {
    console.error(`[API] Download failed for file ${id}:`, err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Download failed" });
  }
});

// ── Upload CSV ───────────────────────────────────────────────
router.post("/admin/upload-csv", requireAuth, requirePermission("admin:upload"), async (req, res) => {
  const userId = getUserId(req);

  const uploadLimit = await uploadLimiter.check(userId);
  if (!uploadLimit.allowed) {
    return res.status(429).json({ error: uploadLimit.message, resetInMs: uploadLimit.resetInMs });
  }

  const { filename, csvContent, tableName, description } = req.body;
  if (!filename || !csvContent || !tableName || !description) {
    return res.status(400).json({ error: "filename, csvContent, tableName, and description are required" });
  }

  const sanitizedTableName = tableName.trim().replace(/[^a-zA-Z0-9_]/g, "");
  const tempFilePath = path.join("/tmp", `csv_${Date.now()}_${filename}`);

  try {
    await fs.promises.writeFile(tempFilePath, csvContent, "utf8");
    await seedCsv(tempFilePath, sanitizedTableName, userId, description, true, "private");
    console.log(`[Upload] CSV seeding done for '${sanitizedTableName}'`);

    const { preview, columns: resultCols, dbtStatus } = await processUploadedTable(
        sanitizedTableName, description, userId, sanitizedTableName
    );

    await mergeIntoCombined(sanitizedTableName, userId, description);

    res.json({
      success: true,
      message: `Table '${sanitizedTableName}' successfully imported.${dbtStatus !== "skipped" ? ` dbt: ${dbtStatus}` : ""}`,
      preview,
      columns: resultCols,
      dbtStatus,
    });
  } catch (err: unknown) {
    log("error", `CSV Upload Error: ${err instanceof Error ? err.message : String(err)}`, req);
    res.status(500).json({ error: err instanceof Error ? err.message : "CSV upload failed" });
  } finally {
    fs.promises.unlink(tempFilePath).catch(() => {});
  }
});

// ── Upload Excel ─────────────────────────────────────────────
router.post("/admin/upload-excel", requireAuth, requirePermission("admin:upload"), upload.single("file"), async (req, res) => {
  const userId = getUserId(req);

  const uploadLimit = await uploadLimiter.check(userId);
  if (!uploadLimit.allowed) {
    return res.status(429).json({ error: uploadLimit.message, resetInMs: uploadLimit.resetInMs });
  }

  const { tableName, description } = req.body;

  if (!req.file || !tableName || !description) {
    return res.status(400).json({ error: "file, tableName, and description are required" });
  }

  const sanitizedTableName = tableName.trim().replace(/[^a-zA-Z0-9_]/g, "");
  const tempPath = req.file.path;
  const originalName = req.file.originalname;
  const extension = path.extname(originalName).toLowerCase();

  if (extension !== ".xlsx" && extension !== ".xls") {
    fs.promises.unlink(tempPath).catch(() => {});
    return res.status(400).json({ error: "Only .xlsx and .xls files are supported." });
  }

  let csvTempPath = "";
  try {
    const XLSX = await import("xlsx");
    // @ts-ignore - xlsx is a CJS module, accessed via default or named
    const xlsxMod = XLSX.default || XLSX;
    const workbook = xlsxMod.readFile(tempPath);
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = xlsxMod.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
    const headerRowIdx = rawRows.findIndex(
      (row) => Array.isArray(row) && (row as unknown[]).filter((c) => c !== "" && c != null).length >= 3
    );
    if (headerRowIdx === -1) throw new Error("Cannot find header row in Excel file.");
    const headerRow = (rawRows[headerRowIdx] as unknown[]).map((h, i) => String(h ?? `col_${i}`));
    const dataRows = rawRows.slice(headerRowIdx + 1).filter(
      (row) => (row as unknown[]).some((c) => c !== "" && c != null)
    );
    if (dataRows.length === 0) throw new Error("No data rows found after header.");
    const jsonData = dataRows.map((row) => {
      const obj: Record<string, unknown> = {};
      headerRow.forEach((h, i) => { obj[h] = (row as unknown[])[i] ?? ""; });
      return obj;
    });

    if (jsonData.length === 0) {
      throw new Error("Excel file is empty or has no data rows.");
    }

    const headers = Object.keys(jsonData[0] as Record<string, unknown>);

    const csvLines: string[] = [];
    const escapeCsv = (val: unknown): string => {
      const str = String(val ?? "");
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    csvLines.push(headers.map(h => escapeCsv(h)).join(","));
    for (const row of jsonData) {
      csvLines.push(headers.map(h => escapeCsv((row as Record<string, unknown>)[h])).join(","));
    }

    const csvContent = csvLines.join("\n");
    csvTempPath = path.join("/tmp", `xls_${Date.now()}_${sanitizedTableName}.csv`);
    fs.writeFileSync(csvTempPath, csvContent, "utf8");
    await seedCsv(csvTempPath, sanitizedTableName, userId, description, true, "private");

    const { preview, columns: resultCols, dbtStatus: xlDbtStatus } = await processUploadedTable(
        sanitizedTableName, description, userId, originalName
    );

    await mergeIntoCombined(sanitizedTableName, userId, description);

    res.json({
      success: true,
      message: `Table '${sanitizedTableName}' successfully imported from Excel.${xlDbtStatus !== "skipped" ? ` dbt: ${xlDbtStatus}` : ""}`,
      preview,
      columns: resultCols,
      dbtStatus: xlDbtStatus,
    });
  } catch (err: unknown) {
    console.error("[API] Excel Upload Error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Excel upload failed" });
  } finally {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
    if (csvTempPath) fs.promises.unlink(csvTempPath).catch(() => {});
  }
});

// ── Upload Document ──────────────────────────────────────────
router.post("/admin/upload-doc", requireAuth, requirePermission("admin:upload"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const userId = getUserId(req);
  const uploadLimit = await uploadLimiter.check(userId);
  if (!uploadLimit.allowed) {
    return res.status(429).json({ error: uploadLimit.message, resetInMs: uploadLimit.resetInMs });
  }

  const { description, category, department } = req.body;
  const tempPath = req.file.path;
  const originalName = req.file.originalname;

  const docId = `doc_${Date.now()}`;
  const safeFilename = `${docId}_${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const savedPath = path.join(DOCUMENTS_DIR, safeFilename);
  const textPath = path.join(DOCUMENTS_DIR, `${docId}.txt`);

  try {
    let extractedText = "";
    const extension = path.extname(originalName).toLowerCase();

    if (extension === ".pdf") {
      const dataBuffer = await fs.promises.readFile(tempPath);
      const parser = new PDFParse({ data: dataBuffer });
      const result = await parser.getText();
      extractedText = result.text;
    } else if (extension === ".docx") {
      const result = await mammoth.extractRawText({ path: tempPath });
      extractedText = result.value;
    } else {
      throw new Error("Unsupported file format.");
    }

    await fs.promises.rename(tempPath, savedPath);
    await fs.promises.writeFile(textPath, extractedText, "utf8");

    await addDocumentToCatalog(
        docId,
        `Document: ${originalName}\nDescription: ${description}\n\nContent:\n${extractedText}`,
        { category: (category === "manual" ? "business_policy" : "data_catalog") as "business_policy" | "data_catalog", department: department || "general", author: getUserId(req) },
        [originalName.toLowerCase(), "document"]
    );

    await initDataLake();
    await getPool().query(
        `INSERT INTO uploaded_files (id, filename, type, description, semantic_groups, generated_at, owner_id, visibility) VALUES ($1, $2, $3, $4, $5, $6, $7, 'private')
         ON CONFLICT (id) DO UPDATE SET filename=EXCLUDED.filename, type=EXCLUDED.type, description=EXCLUDED.description, generated_at=EXCLUDED.generated_at, owner_id=EXCLUDED.owner_id, visibility=EXCLUDED.visibility`,
        [docId, originalName, "document", description, null, new Date().toISOString(), getUserId(req)]
    );

    res.json({ success: true, message: `Document '${originalName}' indexed.` });
  } catch (err: unknown) {
    console.error("[API] Doc Upload Error:", err);
    fs.promises.unlink(tempPath).catch(() => {});
    res.status(500).json({ error: err instanceof Error ? err.message : "Document upload failed" });
  }
});

// ── Feedback ─────────────────────────────────────────────────
const FAILED_QUERIES_PATH = path.join(process.cwd(), "logs", "failed_queries.json");

async function ensureFailedQueriesFile(): Promise<void> {
  const dir = path.dirname(FAILED_QUERIES_PATH);
  await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
  try { await fs.promises.access(FAILED_QUERIES_PATH); }
  catch { await fs.promises.writeFile(FAILED_QUERIES_PATH, "[]", "utf8"); }
}

async function readFailedQueries(): Promise<any[]> {
  await ensureFailedQueriesFile();
  try {
    const raw = await fs.promises.readFile(FAILED_QUERIES_PATH, "utf8");
    return JSON.parse(raw);
  } catch { return []; }
}

router.post("/feedback", async (req, res) => {
  const { message, response, rating, threadId } = req.body;
  if (!message || !rating) {
    return res.status(400).json({ error: "message and rating are required" });
  }
  if (!["positive", "negative"].includes(rating)) {
    return res.status(400).json({ error: "rating must be 'positive' or 'negative'" });
  }

  const entry = {
    id: `feedback_${Date.now()}`,
    userId: getUserId(req),
    message,
    response: response || "",
    rating,
    status: rating === "negative" ? "pending" : "approved",
    threadId: threadId || null,
    timestamp: new Date().toISOString(),
  };

  try {
    await ensureFailedQueriesFile();
    const existing = await readFailedQueries();
    existing.push(entry);
    await fs.promises.writeFile(FAILED_QUERIES_PATH, JSON.stringify(existing, null, 2), "utf8");

    console.log(`[Feedback] ${rating} feedback from ${getUserId(req)}: "${message.slice(0, 80)}..."`);
    const suggestions = rating === "negative"
        ? "Таны санал бүртгэгдлээ. Дараах зүйлсийг санал болгож байна:\n- **Файл оруулах**: Хэрэв өгөгдөл дутуу байвал CSV файлаа upload хийгээрэй\n- **Тодорхой асуулт**: Баганын нэр, огноогоо дурдаж асууна уу\n- **Агент солих**: 'SQL query бич' эсвэл 'борлуулалтын тайлан' гэх мэт чиглэл өгнө үү"
        : "Санал өгсөнд баярлалаа!";
    res.json({ success: true, message: suggestions });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/admin/feedback/pending", requireAuth, requirePermission("admin:users"), async (req, res) => {
  try {
    const all = await readFailedQueries();
    const pending = all.filter((f: any) => f.status === "pending");
    res.json({ success: true, data: pending, count: pending.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/admin/feedback/:id/approve", requireAuth, requirePermission("admin:users"), async (req, res) => {
  const { id } = req.params;

  try {
    const all = await readFailedQueries();
    const entry = all.find((f: any) => f.id === id);
    if (!entry) return res.status(404).json({ error: "Feedback entry not found" });

    if (entry.status === "approved") {
      return res.json({ success: true, message: "Feedback already approved" });
    }

    entry.status = "approved";
    await fs.promises.writeFile(FAILED_QUERIES_PATH, JSON.stringify(all, null, 2), "utf8");

    const correctAnswer = req.body.correctAnswer || "";
    if (entry.response) {
      const ragText = `Failed Query: User asked "${entry.message}". The system responded with: "${entry.response}". This response was rated as incorrect.${correctAnswer ? `\nCorrect answer: ${correctAnswer}` : ""}`;
      await addDocumentToCatalog(entry.id, ragText, {
        category: "previous_analysis",
        department: "analytics",
        author: entry.userId,
        source_name: "User Feedback",
        shared: true,
      }, ["failed_query", "feedback", ...entry.message.toLowerCase().split(/\W+/).filter(Boolean)]);
    }

    res.json({ success: true, message: "Feedback approved and added to RAG" });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/admin/feedback/:id/reject", requireAuth, requirePermission("admin:users"), async (req, res) => {
  const { id } = req.params;

  try {
    const all = await readFailedQueries();
    const entry = all.find((f: any) => f.id === id);
    if (!entry) return res.status(404).json({ error: "Feedback entry not found" });

    entry.status = "rejected";
    await fs.promises.writeFile(FAILED_QUERIES_PATH, JSON.stringify(all, null, 2), "utf8");

    res.json({ success: true, message: "Feedback rejected" });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
