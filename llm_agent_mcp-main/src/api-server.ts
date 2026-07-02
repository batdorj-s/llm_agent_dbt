/**
 * api-server.ts — Express REST API for the Chat UI
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createToken, requireJwtSecret, verifyBearerHeader, verifyToken, requireRole, roleAtLeast } from "./auth.js";
import { agentLimiter, authLimiter } from "./rate-limiter.js";
import { detectProvider } from "./llm-provider.js";
import { getRepository } from "./db/kpi-repository.js";
import { setupKnowledgeBase } from "./rag.js";
import { ensureProjectReady, runDbtForTable, runDbtTest, runDbtFinanceModels } from "./setup/init.js";
import { generateSchemaYml } from "./setup/generate-schema.js";
import { runMultiAgent, runMultiAgentStream, clearConversationMemory } from "./multi-agent.js";
import type { UserRole } from "./multi-agent.js";
import { seedCsv, initDataLake, getCatalog, getPool, getActiveCatalogEntry, getColumnSamples, getColumnProfile, computeTableKpis, detectForeignKeys, authenticateUser, createUser, quoteIdent } from "./db/data-lake.js";
import { findConceptColumn } from "./agents/columnSynonyms.js";
import { buildMntAmountExpr } from "./utils/sqlHelpers.js";
import { addDocumentToCatalog, removeDocumentsByPrefix } from "./rag.js";
import { buildSemanticGroups, formatSemanticGroups } from "./utils.js";
import { computeMetrics } from "./agents/reportMetrics.js";
import { generateReportPdf, generateReportXlsx } from "./agents/reportExport.js";
import { generateDataPassport } from "./agents/dataProfiler.js";
import fs from "fs";
import path from "path";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
app.use(express.json({ limit: "50mb" }));

// Request ID middleware
app.use((req, _res, next) => {
    const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    (req as any).reqId = reqId;
    next();
});

function log(level: "info" | "warn" | "error", msg: string, req?: any, meta?: Record<string, unknown>) {
    const entry: Record<string, unknown> = {
        t: new Date().toISOString(),
        lvl: level,
        msg,
        reqId: req?.reqId || "-",
    };
    if (meta) Object.assign(entry, meta);
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(JSON.stringify(entry));
}

// Configure Multer for file uploads
const UPLOAD_DIR = "uploads/";
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
]);

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: Excel, PDF, DOCX, CSV`));
    }
  },
});

// ─────────────────────────────────────────────────────────────
// Health / Status
// ─────────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  const provider = detectProvider();
  res.json({
    status: "ok",
    llm: {
      provider: provider.provider,
      model: provider.model,
      isFree: provider.isFree,
      rateLimit: provider.rateLimit,
    },
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────
// Auth — Login (credential verification)
// ─────────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const rl = authLimiter.check(ip);
  if (!rl.allowed) {
    return res.status(429).json({ error: rl.message });
  }

  try {
    const user = await authenticateUser(email, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = createToken(user.id, user.role);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      message: `Logged in as ${user.name}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Auth — Register (admin only)
// ─────────────────────────────────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }
  if (auth.payload.role !== "admin") {
    return res.status(403).json({ error: "Only admins can create new users" });
  }

  const { email, password, name, role } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: "email, password, and name are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const rl = authLimiter.check(ip);
  if (!rl.allowed) {
    return res.status(429).json({ error: rl.message });
  }

  const userRole: UserRole = role === "analyst" ? "analyst" : role === "admin" ? "admin" : "viewer";

  try {
    const userId = await createUser(email, password, name, userRole);
    if (!userId) {
      return res.status(409).json({ error: "Email already registered" });
    }
    res.status(201).json({ success: true, userId, role: userRole });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Chat — Standard (non-streaming)
// ─────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const { userId, role } = auth.payload;
  const limit = agentLimiter.check(userId);
  if (!limit.allowed) {
    return res.status(429).json({ error: limit.message, resetInMs: limit.resetInMs });
  }

  const { message, threadId, visualRequest } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  try {
    const threadIdFinal = threadId ?? `thread_${Date.now()}`;
    const response = await runMultiAgent(message, role, threadIdFinal, visualRequest, userId);

    res.json({
      response,
      threadId: threadIdFinal,
      role,
      remaining: limit.remaining,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Chat Streaming — SSE (Server-Sent Events)
// ─────────────────────────────────────────────────────────────
app.post("/api/chat/stream", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const { userId, role } = auth.payload;
  const limit = agentLimiter.check(userId);
  if (!limit.allowed) {
    return res.status(429).json({ error: limit.message });
  }

  const { message, threadId, visualRequest } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const threadIdFinal = threadId ?? `thread_${Date.now()}`;
  let fullResponse = "";

  try {
    await runMultiAgentStream(message, role, threadIdFinal, (chunk) => {
      fullResponse += chunk;
      res.write(`data: ${JSON.stringify({ chunk, type: "delta" })}\n\n`);
    }, visualRequest, userId);
    res.write(`data: ${JSON.stringify({ type: "done", full: fullResponse, threadId: threadIdFinal })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// ─────────────────────────────────────────────────────────────
function extractDateFilter(req: any): { startDate?: string; endDate?: string } {
  return {
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
  };
}

// KPI Dashboard Data
// ─────────────────────────────────────────────────────────────
app.get("/api/kpi/:metric", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const { metric } = req.params;
  const VALID_METRICS = ["sales", "users", "churn_rate"];
  if (!VALID_METRICS.includes(metric)) {
    return res.status(400).json({ error: `Invalid metric '${metric}'. Must be one of: ${VALID_METRICS.join(", ")}` });
  }

  const repo = await getRepository();
  const dateFilter = extractDateFilter(req);
  const userId = auth.payload.userId;

  // Finance table override for "sales" metric
  if (metric === "sales") {
    try {
      const entry = await getActiveCatalogEntry(userId);
      if (entry) {
        const cols: string[] = JSON.parse(entry.columns_info);
        const amtCol = findConceptColumn(cols, "finance_amount", entry.table_name);
        const catCol = findConceptColumn(cols, "finance_category", entry.table_name);
        if (amtCol && catCol) {
          const qAmt = buildMntAmountExpr(quoteIdent(amtCol));
          const qCat = quoteIdent(catCol);
          const qTbl = quoteIdent(entry.table_name);
          const result = await getPool().query(`
            SELECT COALESCE(SUM(${qAmt}), 0) as total
            FROM ${qTbl}
            WHERE ${qCat} ILIKE '%орлого%' AND ${qCat} NOT ILIKE '%зээл%'
          `);
          const current = Math.round(Number(result.rows[0]?.total || 0) * 100) / 100;
          const targetResult = await getPool().query(
            `SELECT target_value, unit FROM kpi_targets WHERE metric_name = $1`, ["sales"]
          );
          const targetRow = targetResult.rows[0] as any;
          return res.json({
            name: "sales", current,
            target: targetRow?.target_value ?? 200000000,
            unit: targetRow?.unit ?? "₮",
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.warn("[KPI] Finance sales override failed:", (err as Error).message);
    }
  }

  try {
    const data = await repo.getKpi(metric as any, dateFilter, userId);
    if (!data) return res.status(404).json({ error: `Metric '${metric}' not found` });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/kpi-history", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const limit = req.query.limit ? Number(req.query.limit) : 6;
  const repo = await getRepository();
  const dateFilter = extractDateFilter(req);
  const history = await repo.getSalesHistory(limit, dateFilter, auth.payload.userId);
  res.json(history);
});

// ─────────────────────────────────────────────────────────────
// Dashboard — Computed Metrics (AOV, Growth Rate, Top Category)
// ─────────────────────────────────────────────────────────────
app.get("/api/dashboard/computed-metrics", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const { startDate, endDate } = extractDateFilter(req);

  try {
    const metrics = await computeMetrics(auth.payload.userId, startDate, endDate);
    if (!metrics) return res.status(404).json({ error: "No active dataset found" });
    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Finance Default Charts
// ─────────────────────────────────────────────────────────────
app.get("/api/finance-charts", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) return res.status(401).json({ error: auth.error });

  const userId = auth.payload.userId;
  const pool = getPool();

  try {
    const entry = await getActiveCatalogEntry(userId);
    if (!entry) return res.json({ isFinance: false });

    const columns: string[] = JSON.parse(entry.columns_info);
    const table = entry.table_name;

    const amtCol    = findConceptColumn(columns, "finance_amount",      table);
    const catCol    = findConceptColumn(columns, "finance_category",    table);
    const subCatCol = findConceptColumn(columns, "finance_subcategory", table);
    const dateCol   = findConceptColumn(columns, "finance_date",        table);
    const partyCol  = findConceptColumn(columns, "finance_party",       table);

    if (!amtCol || !catCol) return res.json({ isFinance: false });

    const qAmt    = buildMntAmountExpr(quoteIdent(amtCol));
    const qCat    = quoteIdent(catCol);
    const qSubCat = subCatCol ? quoteIdent(subCatCol) : null;
    const qTbl    = quoteIdent(table);

    // Shared filter expressions
    // Operating income: ангилал ILIKE '%орлого%' AND NOT '%зээл%'
    const isOpIncome  = `(${qCat} ILIKE '%орлого%' AND ${qCat} NOT ILIKE '%зээл%')`;
    // Operating expense: only known operating subcategories.
    // Excludes Зарлага/Зээл (loan repayments) and Зарлага/Бусад (catches misclassified
    // internal transfers like "КАСС РУУ ХИЙВ" that should be Дотоод шилжүүлэг).
    const isOpExpense = qSubCat
      ? `(${qCat} ILIKE '%зарлага%' AND ${qSubCat} NOT ILIKE '%зээл%' AND ${qSubCat} NOT ILIKE '%бусад%')`
      : `${qCat} ILIKE '%зарлага%'`;
    // Noise filter: exclude internal transfers and owner loans (Дотоод шилжүүлэг, Эздийн зээл)
    const notNoise = `${qCat} NOT ILIKE '%шилжүүлэг%' AND ${qCat} NOT ILIKE '%эздийн зээл%'`;

    const charts: any[] = [];

    // 1. Category breakdown — operating expense by subcategory (excl. loan repayments)
    try {
      const groupCol = qSubCat ?? qCat;
      const r = await pool.query(`
        SELECT ${groupCol} AS label, SUM(${qAmt}) AS value
        FROM ${qTbl}
        WHERE ${isOpExpense} AND ${groupCol} IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 7
      `);
      if (r.rows.length > 0) {
        charts.push({
          id: "category_breakdown",
          title: "Зарлагын бүтэц (үйл ажиллагааны)",
          type: "donut",
          data: r.rows.map((row: any) => ({ label: String(row.label ?? ""), value: Number(row.value ?? 0) })),
          config: { xAxis: "label", yAxis: "value" },
        });
      }
    } catch {}

    // 2. Monthly cashflow — operating income vs operating expense
    if (dateCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const r = await pool.query(`
          SELECT
            TO_CHAR(${qDate}::DATE, 'YYYY-MM') AS label,
            SUM(CASE WHEN ${isOpIncome}  THEN ${qAmt} ELSE 0 END) AS value,
            SUM(CASE WHEN ${isOpExpense} THEN ${qAmt} ELSE 0 END) AS value2
          FROM ${qTbl}
          WHERE ${qDate} IS NOT NULL AND ${notNoise}
          GROUP BY 1 ORDER BY 1
        `);
        if (r.rows.length > 0) {
          charts.push({
            id: "monthly_cashflow",
            title: "Сарын орлого / зарлага",
            type: "stacked_bar",
            data: r.rows.map((row: any) => ({
              label: String(row.label ?? ""),
              value: Number(row.value ?? 0),
              value2: Number(row.value2 ?? 0),
            })),
            config: { xAxis: "label", yAxis: "value", series: ["value", "value2"], stacked: true, seriesLabels: ["Орлого", "Зарлага"] },
          });
        }
      } catch {}
    }

    // 3. Income sources by counterparty (horizontal_bar)
    if (partyCol) {
      try {
        const qParty = quoteIdent(partyCol);
        const r = await pool.query(`
          SELECT ${qParty} AS label, SUM(${qAmt}) AS value
          FROM ${qTbl}
          WHERE ${isOpIncome} AND ${qParty} IS NOT NULL AND ${qParty} != ''
          GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 10
        `);
        if (r.rows.length > 0) {
          charts.push({
            id: "top_parties",
            title: "Орлогын эх үүсвэр (харилцагчаар)",
            type: "horizontal_bar",
            data: r.rows.map((row: any) => ({ label: String(row.label ?? ""), value: Number(row.value ?? 0) })),
            config: { xAxis: "label", yAxis: "value" },
          });
        }
      } catch {}
    }

    // 4. Daily net cashflow (line) — income minus operating expense per day
    if (dateCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const r = await pool.query(`
          SELECT
            ${qDate}::DATE AS label,
            SUM(CASE WHEN ${isOpIncome}  THEN ${qAmt} ELSE 0 END) -
            SUM(CASE WHEN ${isOpExpense} THEN ${qAmt} ELSE 0 END) AS value
          FROM ${qTbl}
          WHERE ${qDate} IS NOT NULL AND ${notNoise}
          GROUP BY 1 ORDER BY 1
        `);
        if (r.rows.length > 0) {
          charts.push({
            id: "daily_trend",
            title: "Өдрийн цэвэр орлого",
            type: "line",
            data: r.rows.map((row: any) => ({ label: String(row.label ?? ""), value: Number(row.value ?? 0) })),
            config: { xAxis: "label", yAxis: "value" },
          });
        }
      } catch {}
    }

    res.json({ isFinance: charts.length > 0, tableName: table, charts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Report Export — PDF / Excel (JWT-scoped userId)
// ─────────────────────────────────────────────────────────────
app.post("/api/report/export-pdf", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const { startDate, endDate } = extractDateFilter(req);

  try {
    const pdfBuffer = await generateReportPdf(auth.payload.userId, startDate, endDate);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report-${new Date().toISOString().split("T")[0]}.pdf"`);
    res.send(pdfBuffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/report/export-xlsx", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const { startDate, endDate } = extractDateFilter(req);

  try {
    const xlsxBuffer = await generateReportXlsx(auth.payload.userId, startDate, endDate);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="report-${new Date().toISOString().split("T")[0]}.xlsx"`);
    res.send(xlsxBuffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// File Management
// ─────────────────────────────────────────────────────────────
app.get("/api/admin/files", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) return res.status(401).json({ error: auth.error });
  if (!roleAtLeast(auth.payload.role, "analyst")) return res.status(403).json({ error: "Access denied. Analyst role required." });

  await initDataLake();
  const result = await getPool().query(`SELECT * FROM uploaded_files ORDER BY created_at DESC`);
  res.json(result.rows);
});

app.delete("/api/admin/files/:id", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) return res.status(401).json({ error: auth.error });
  if (!roleAtLeast(auth.payload.role, "analyst")) return res.status(403).json({ error: "Access denied. Analyst role required." });

  const { id } = req.params;
  await initDataLake();

  const fileResult = await getPool().query(`SELECT * FROM uploaded_files WHERE id = $1`, [id]);
  const file = fileResult.rows[0] as any;
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
      try { fs.unlinkSync(path.join(DOCUMENTS_DIR, safeFilename)); } catch {}
      try { fs.unlinkSync(path.join(DOCUMENTS_DIR, `${id}.txt`)); } catch {}
      await removeDocumentsByPrefix(`${id}_`);
      await clearConversationMemory();
    }
    await getPool().query(`DELETE FROM uploaded_files WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/files/:id/preview", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) return res.status(401).json({ error: auth.error });

  const { id } = req.params;
  await initDataLake();

  try {
    const fileResult = await getPool().query(`SELECT * FROM uploaded_files WHERE id = $1`, [id]);
    const file = fileResult.rows[0] as any;
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

    // Document: read extracted text file
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
      content: content.substring(0, 10000), // cap at 10K chars
      hasDownload: fs.existsSync(path.join(DOCUMENTS_DIR, `${id}_${file.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`)),
    });
  } catch (err: any) {
    console.error(`[API] Preview failed for file ${id}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/files/:id/download", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) return res.status(401).json({ error: auth.error });
  if (!roleAtLeast(auth.payload.role, "analyst")) return res.status(403).json({ error: "Access denied. Analyst role required." });

  const { id } = req.params;
  await initDataLake();

  try {
    const fileResult = await getPool().query(`SELECT * FROM uploaded_files WHERE id = $1`, [id]);
    const file = fileResult.rows[0] as any;
    if (!file) return res.status(404).json({ error: "File not found" });
    if (file.type !== "document") return res.status(400).json({ error: "Only documents can be downloaded" });

    const safeFilename = `${id}_${file.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(DOCUMENTS_DIR, safeFilename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not available" });

    res.download(filePath, file.filename);
  } catch (err: any) {
    console.error(`[API] Download failed for file ${id}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

function buildColumnMapping(cols: string[]): Record<string, string | null> {
  const colLower = cols.map(c => c.toLowerCase());
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

// ─────────────────────────────────────────────────────────────
// Shared post-seed logic for CSV and Excel upload handlers
// ─────────────────────────────────────────────────────────────
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
    const tableInfo = catalog.find((row: any) => row.table_name === sanitizedTableName) as any;

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
        const ragText = `Data Lake Catalog: The table '${sanitizedTableName}' is loaded into a PostgreSQL database. Columns: ${sampleText}. Description: ${description}.`;
        await addDocumentToCatalog(`uploaded_${sanitizedTableName}_${Date.now()}`, ragText, {
            category: "data_catalog",
            department: "analytics",
            author: userId || "unknown",
            source_name: `Upload: ${sanitizedTableName}`,
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

        // Generate data passport (async, non-blocking)
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

// ─────────────────────────────────────────────────────────────
// Admin: Upload CSV Dataset
// ─────────────────────────────────────────────────────────────
app.post("/api/admin/upload-csv", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const { userId, role } = auth.payload;
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

    res.json({
      success: true,
      message: `Table '${sanitizedTableName}' successfully imported.${dbtStatus !== "skipped" ? ` dbt: ${dbtStatus}` : ""}`,
      preview,
      columns: resultCols,
      dbtStatus,
    });
  } catch (err: any) {
    log("error", `CSV Upload Error: ${err.message}`, req);
    res.status(500).json({ error: err.message });
  } finally {
    fs.promises.unlink(tempFilePath).catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────
// Admin: Upload Excel (XLSX/XLS)
// ─────────────────────────────────────────────────────────────
app.post("/api/admin/upload-excel", upload.single("file"), async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const { userId, role } = auth.payload;
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
    const jsonData = xlsxMod.utils.sheet_to_json(sheet, { defval: "" });

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

    res.json({
      success: true,
      message: `Table '${sanitizedTableName}' successfully imported from Excel.${xlDbtStatus !== "skipped" ? ` dbt: ${xlDbtStatus}` : ""}`,
      preview,
      columns: resultCols,
      dbtStatus: xlDbtStatus,
    });
  } catch (err: any) {
    console.error("[API] Excel Upload Error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
    if (csvTempPath) fs.promises.unlink(csvTempPath).catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────
// Admin: Upload Document (PDF/DOCX)
// ─────────────────────────────────────────────────────────────
const DOCUMENTS_DIR = "uploads/documents/";
if (!fs.existsSync(DOCUMENTS_DIR)) {
  fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
}

app.post("/api/admin/upload-doc", upload.single("file"), async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(401).json({ error: auth.error });
  }

  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

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

    // Save original file permanently
    await fs.promises.rename(tempPath, savedPath);
    // Save extracted text
    await fs.promises.writeFile(textPath, extractedText, "utf8");

    await addDocumentToCatalog(
        docId,
        `Document: ${originalName}\nDescription: ${description}\n\nContent:\n${extractedText}`,
        { category: (category === "manual" ? "business_policy" : "data_catalog") as "business_policy" | "data_catalog", department: department || "general", author: auth.payload.userId },
        [originalName.toLowerCase(), "document"]
    );

    await initDataLake();
    await getPool().query(
        `INSERT INTO uploaded_files (id, filename, type, description, semantic_groups, generated_at, owner_id, visibility) VALUES ($1, $2, $3, $4, $5, $6, $7, 'private')
         ON CONFLICT (id) DO UPDATE SET filename=EXCLUDED.filename, type=EXCLUDED.type, description=EXCLUDED.description, generated_at=EXCLUDED.generated_at, owner_id=EXCLUDED.owner_id, visibility=EXCLUDED.visibility`,
        [docId, originalName, "document", description, null, new Date().toISOString(), auth.payload.userId]
    );

    res.json({ success: true, message: `Document '${originalName}' indexed.` });
  } catch (err: any) {
    console.error("[API] Doc Upload Error:", err);
    fs.promises.unlink(tempPath).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Feedback Loop: User rating (positive / negative)
// ─────────────────────────────────────────────────────────────
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

app.post("/api/feedback", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const { message, response, rating, threadId } = req.body;
  if (!message || !rating) {
    return res.status(400).json({ error: "message and rating are required" });
  }
  if (!["positive", "negative"].includes(rating)) {
    return res.status(400).json({ error: "rating must be 'positive' or 'negative'" });
  }

  const entry = {
    id: `feedback_${Date.now()}`,
    userId: auth.payload.userId,
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

    // Do NOT add to RAG automatically. It must be approved by admin.

    console.log(`[Feedback] ${rating} feedback from ${auth.payload.userId}: "${message.slice(0, 80)}..."`);
    const suggestions = rating === "negative"
        ? "Таны санал бүртгэгдлээ. Дараах зүйлсийг санал болгож байна:\n- **Файл оруулах**: Хэрэв өгөгдөл дутуу байвал CSV файлаа upload хийгээрэй\n- **Тодорхой асуулт**: Баганын нэр, огноогоо дурдаж асууна уу\n- **Агент солих**: 'SQL query бич' эсвэл 'борлуулалтын тайлан' гэх мэт чиглэл өгнө үү"
        : "Санал өгсөнд баярлалаа!";
    res.json({ success: true, message: suggestions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/feedback/pending - get pending feedback items
app.get("/api/admin/feedback/pending", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) return res.status(401).json({ error: auth.error });
  if (auth.payload.role !== "admin") return res.status(403).json({ error: "Access denied. Admins only." });

  try {
    const all = await readFailedQueries();
    const pending = all.filter((f: any) => f.status === "pending");
    res.json(pending);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/feedback/:id/approve - approve a feedback entry and add to RAG
app.post("/api/admin/feedback/:id/approve", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) return res.status(401).json({ error: auth.error });
  if (auth.payload.role !== "admin") return res.status(403).json({ error: "Access denied. Admins only." });

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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/feedback/:id/reject - reject a feedback entry (do not add to RAG)
app.post("/api/admin/feedback/:id/reject", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) return res.status(401).json({ error: auth.error });
  if (auth.payload.role !== "admin") return res.status(403).json({ error: "Access denied. Admins only." });

  const { id } = req.params;

  try {
    const all = await readFailedQueries();
    const entry = all.find((f: any) => f.id === id);
    if (!entry) return res.status(404).json({ error: "Feedback entry not found" });

    entry.status = "rejected";
    await fs.promises.writeFile(FAILED_QUERIES_PATH, JSON.stringify(all, null, 2), "utf8");

    res.json({ success: true, message: "Feedback rejected" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Adjust KPI Targets
// ─────────────────────────────────────────────────────────────
app.post("/api/kpi/:metric/target", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const { metric } = req.params;
  const VALID_METRICS = ["sales", "users", "churn_rate"];
  if (!VALID_METRICS.includes(metric)) {
    return res.status(400).json({ error: `Invalid metric '${metric}'. Must be one of: ${VALID_METRICS.join(", ")}` });
  }

  const { target } = req.body;
  
  try {
    const repo = await getRepository();
    await repo.updateKpiTarget(metric as any, Number(target));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Centralized error handler middleware
// ─────────────────────────────────────────────────────────────
app.use((err: any, _req: any, res: any, _next: any) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large. Maximum size is 10MB." });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err.message?.startsWith("Unsupported file type")) {
    return res.status(415).json({ error: err.message });
  }
  console.error("[API] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.API_PORT || 3001;
async function start() {
  try {
    await ensureProjectReady();
  } catch (err) {
    console.warn("[API] Data Lake initialization failed — running in limited mode:", (err as Error).message);
  }
  await setupKnowledgeBase();

  requireJwtSecret();

  app.listen(PORT, () => {
    console.log(`\nAPI Server running at http://localhost:${PORT}`);
  });
}
if (process.env.NODE_ENV !== "test") {
  start().catch((err) => {
    console.error("Failed to start API server:", err);
    process.exit(1);
  });
}

export { app };
