/**
 * api-server.ts — Express REST API for the Chat UI
 *
 * Route modules:
 *   /api/chat/*  → src/routes/chat.router.ts
 *   (remaining routes pending extraction to kpi/admin/report routers)
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { chatRouter } from "./routes/chat.router.js";
import { requestContext } from "./context.js";
import { agentLimiter, uploadLimiter } from "./rate-limiter.js";
import helmet from "helmet";
import { detectProvider } from "./llm-provider.js";
import { getRepository } from "./db/kpi-repository.js";
import { setupKnowledgeBase } from "./rag.js";
import { ensureProjectReady, runDbtForTable, runDbtTest, runDbtFinanceModels } from "./setup/init.js";
import { requireAuth, createToken, verifyToken } from "./auth.js";
import { authenticateUser, createUser } from "./db/data-lake.js";
import type { UserRole } from "./multi-agent.js";
import { generateSchemaYml } from "./setup/generate-schema.js";
import { runMultiAgent, runMultiAgentStream, clearConversationMemory } from "./multi-agent.js";
import { seedCsv, initDataLake, getCatalog, getPool, getActiveCatalogEntry, getColumnSamples, getColumnProfile, computeTableKpis, detectForeignKeys, quoteIdent, mergeIntoCombined, buildNoiseSubcategoryFilter } from "./db/data-lake.js";
import { initConversationSchema, createConversation, getConversations, getConversationById, deleteConversation, addMessage, getMessages, searchConversations, updateConversationTitle } from "./services/conversation.js";
import { findConceptColumn } from "./agents/columnSynonyms.js";
import { buildMntAmountExpr } from "./utils/sqlHelpers.js";
import { addDocumentToCatalog, removeDocumentsByPrefix, getPassportByTableName, parsePassportQuestions } from "./rag.js";
import { buildSemanticGroups, formatSemanticGroups } from "./utils.js";
import { sendSuccess, sendError, asyncHandler } from "./utils/apiResponse.js";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";
import exportRouter from "./routes/export.router.js";
import { scanAlerts } from "./services/alerts.js";
import { requirePermission, getPermissions } from "./middleware/rbac.js";

// ── Swagger/OpenAPI Setup ───────────────────────────────────────
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Шинжээч.ai API",
      version: "1.0.0",
      description: "Mongolian AI Data Analytics Platform — multi-agent system with RAG, KPI dashboards, and SQL analysis.",
    },
    servers: [{ url: "http://localhost:3001", description: "Local dev" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./src/api-server.ts"],
});

// ── Request Timeout Middleware ──────────────────────────────────
const REQUEST_TIMEOUT_MS = 60_000; // 60 seconds
function requestTimeout(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout", message: "Request exceeded 60s limit" });
    }
  }, REQUEST_TIMEOUT_MS);
  res.on("finish", () => clearTimeout(timer));
  res.on("close", () => clearTimeout(timer));
  next();
}
import { computeMetrics } from "./agents/reportMetrics.js";
import { generateReportPdf, generateReportXlsx } from "./agents/reportExport.js";
import { generateDataPassport } from "./agents/dataProfiler.js";
import fs from "fs";
import path from "path";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

dotenv.config();

interface DbFileRow {
  id: string;
  type: string;
  filename: string;
  description?: string;
  created_at?: string;
  [key: string]: unknown;
}

/** Helper: extract userId from request (set by requireAuth middleware) */
function getUserId(req: express.Request): string {
  return (req as express.Request & { userId: string }).userId || "user-admin-001";
}
/** Helper: extract role from request (set by requireAuth middleware) */
function getRole(req: express.Request): UserRole {
  return (req as express.Request & { role: UserRole }).role || "admin";
}

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
app.use(express.json({ limit: "5mb" }));

// Request ID middleware — propagates requestId through the entire async call chain
app.use((req, _res, next) => {
    const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    req.reqId = reqId;
    _res.setHeader("X-Request-Id", reqId);
    requestContext.run({ requestId: reqId, ipAddress: req.ip }, next);
});

// Auth middleware — extracts userId and role from JWT on every request
app.use(requireAuth);

// Request timeout — kill requests that exceed 60s
app.use(requestTimeout);

// Request logging middleware — logs all incoming requests
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    log(level as "info" | "warn" | "error", `${req.method} ${req.path} ${res.statusCode}`, req, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
      ip: req.ip,
    });
  });
  next();
});

function log(level: "info" | "warn" | "error", msg: string, req?: express.Request, meta?: Record<string, unknown>) {
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

const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE_MB || "10", 10) * 1024 * 1024;

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: Excel, PDF, DOCX, CSV`));
    }
  },
});

// ── Feature routers ──────────────────────────────────────────
app.use("/api/chat", chatRouter);

// ─────────────────────────────────────────────────────────────
// Health / Status
// ─────────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/health:
 *   get:
 *     tags: [System]
 *     summary: Health check with service status
 *     responses:
 *       200:
 *         description: System health with PostgreSQL and ChromaDB status
 */
app.get("/api/health", async (_req, res) => {
  const checks: Record<string, string> = {};

  // Check PostgreSQL
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    checks.postgresql = "ok";
  } catch {
    checks.postgresql = "unavailable";
  }

  // Check ChromaDB
  try {
    const ragModule = await import("./rag.js");
    const client = (ragModule as any).chromaClient;
    if (client && typeof client.heartbeat === "function") {
      await client.heartbeat();
      checks.chromadb = "ok";
    } else {
      checks.chromadb = "unavailable";
    }
  } catch {
    checks.chromadb = "unavailable";
  }

  const mem = process.memoryUsage();
  const status = Object.values(checks).every(v => v === "ok") ? "ok" : "degraded";

  res.json({
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: checks,
    memory: {
      rss: `${(mem.rss / 1024 / 1024).toFixed(1)}MB`,
      heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`,
    },
  });
});

// ── Swagger UI ───────────────────────────────────────────────
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: "Шинжээч.ai API Docs",
  customCss: ".swagger-ui .topbar { display: none }",
}));
app.get("/api-docs.json", (_req, res) => {
  res.json(swaggerSpec);
});

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
import { z } from "zod";

const DateFilterSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD").optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD").optional(),
});

function extractDateFilter(req: express.Request): { startDate?: string; endDate?: string } {
  const parsed = DateFilterSchema.safeParse({
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  });
  if (!parsed.success) return {};
  return parsed.data;
}

// KPI Dashboard Data
// ─────────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/kpi/{metric}:
 *   get:
 *     tags: [KPI]
 *     summary: Get KPI metric data
 *     parameters:
 *       - in: path
 *         name: metric
 *         required: true
 *         schema:
 *           type: string
 *           enum: [sales, users, churn_rate]
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: KPI metric data
 *       400:
 *         description: Invalid metric
 */
app.get("/api/kpi/:metric", async (req, res) => {
  const userId = getUserId(req);

  const { metric } = req.params;
  const VALID_METRICS = ["sales", "users", "churn_rate"];
  if (!VALID_METRICS.includes(metric)) {
    return res.status(400).json({ error: `Invalid metric '${metric}'. Must be one of: ${VALID_METRICS.join(", ")}` });
  }

  const repo = await getRepository();
  const dateFilter = extractDateFilter(req);

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
          const targetRow = targetResult.rows[0] as Record<string, unknown>;
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
    const data = await repo.getKpi(metric as "sales" | "users" | "churn_rate", dateFilter, userId);
    if (!data) return res.status(404).json({ error: `Metric '${metric}' not found` });
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

app.get("/api/kpi-history", async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 6;
  const repo = await getRepository();
  const dateFilter = extractDateFilter(req);
  const history = await repo.getSalesHistory(limit, dateFilter, getUserId(req));
  res.json(history);
});

// ─────────────────────────────────────────────────────────────
// Anomaly Detection — Z-score & IQR based
// ─────────────────────────────────────────────────────────────
app.get("/api/kpi/anomalies", requireAuth, requirePermission("kpi:anomaly"), async (req, res) => {
  try {
    const userId = getUserId(req);
    const pool = getPool();
    const entry = await getActiveCatalogEntry(userId);
    if (!entry) return res.json({ anomalies: [], columns: [], totalRows: 0 });

    const tableName = entry.table_name;
    let columnList: string[] = [];
    try { columnList = JSON.parse(entry.columns_info) as string[]; } catch {}

    const numericKeywords = [/age/i, /amount/i, /balance/i, /price/i, /cost/i, /revenue/i, /sales/i,
      /income/i, /profit/i, /spend/i, /value/i, /quantity/i, /count/i, /rate/i, /score/i,
      /total/i, /sum/i, /avg/i, /num/i, /rating/i, /зардал/i, /орлого/i];
    const numericCols = columnList.filter(col => numericKeywords.some(p => p.test(col)));
    if (numericCols.length === 0) return res.json({ anomalies: [], columns: numericCols, totalRows: 0 });

    const limitRows = Number(req.query.limit) || 2000;
    const safeCols = columnList.map(c => `"${c}"`).join(", ");
    const { rows } = await pool.query(`SELECT ${safeCols} FROM "${tableName}" LIMIT $1`, [limitRows]);

    const anomalies: Array<{
      rowIndex: number;
      columnName: string;
      value: number;
      zScore: number;
      method: "z-score" | "iqr";
      row: Record<string, unknown>;
    }> = [];

    for (const col of numericCols) {
      const values = rows.map(r => Number(r[col])).filter(v => !isNaN(v));
      if (values.length < 10) continue;

      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
      if (std === 0) continue;

      const sorted = [...values].sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;
      const iqrLow = q1 - 1.5 * iqr;
      const iqrHigh = q3 + 1.5 * iqr;

      rows.forEach((row, idx) => {
        const val = Number(row[col]);
        if (isNaN(val)) return;
        const z = Math.abs((val - mean) / std);
        const isZAnomaly = z > 3;
        const isIqrAnomaly = val < iqrLow || val > iqrHigh;
        if (isZAnomaly || isIqrAnomaly) {
          anomalies.push({
            rowIndex: idx,
            columnName: col,
            value: val,
            zScore: Math.round(z * 100) / 100,
            method: isZAnomaly ? "z-score" : "iqr",
            row: row as Record<string, unknown>,
          });
        }
      });
    }

    anomalies.sort((a, b) => b.zScore - a.zScore);

    res.json({
      anomalies: anomalies.slice(0, 100),
      columns: numericCols,
      totalRows: rows.length,
      summary: {
        totalAnomalies: anomalies.length,
        byColumn: numericCols.reduce((acc, col) => {
          acc[col] = anomalies.filter(a => a.columnName === col).length;
          return acc;
        }, {} as Record<string, number>),
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// What-If Scenario — simulate impact of changing a value
// ─────────────────────────────────────────────────────────────
app.post("/api/whatif", requireAuth, requirePermission("kpi:whatif"), async (req, res) => {
  try {
    const userId = getUserId(req);
    const { column, changePercent, scenarioName } = req.body;

    if (!column || typeof column !== "string") {
      return res.status(400).json({ error: "column is required" });
    }
    if (changePercent === undefined || typeof changePercent !== "number") {
      return res.status(400).json({ error: "changePercent (number) is required" });
    }
    if (Math.abs(changePercent) > 1000) {
      return res.status(400).json({ error: "changePercent must be between -1000 and 1000" });
    }

    const entry = await getActiveCatalogEntry(userId);
    if (!entry) return res.status(404).json({ error: "No active dataset" });

    const tableName = entry.table_name;
    let columnList: string[] = [];
    try { columnList = JSON.parse(entry.columns_info) as string[]; } catch {}

    if (!columnList.includes(column)) {
      return res.status(400).json({ error: `Column "${column}" not found in dataset` });
    }

    const numericKeywords = [/age/i, /amount/i, /balance/i, /price/i, /cost/i, /revenue/i, /sales/i,
      /income/i, /profit/i, /spend/i, /value/i, /quantity/i, /count/i, /rate/i, /score/i,
      /total/i, /sum/i, /avg/i, /num/i, /rating/i, /зардал/i, /орлого/i];
    const numericCols = columnList.filter(col => numericKeywords.some(p => p.test(col)));
    const targetCols = numericCols.filter(c => c !== column);
    const targetColumn = req.body.targetColumn && targetCols.includes(req.body.targetColumn)
      ? req.body.targetColumn
      : targetCols[0] || column;

    const pool = getPool();
    const safeCols = columnList.map(c => `"${c}"`).join(", ");
    const { rows } = await pool.query(`SELECT ${safeCols} FROM "${tableName}" LIMIT 2000`);

    // Compute baseline stats
    const baselineValues = rows.map(r => Number(r[targetColumn])).filter(v => !isNaN(v));
    const baselineSum = baselineValues.reduce((a, b) => a + b, 0);
    const baselineMean = baselineValues.length > 0 ? baselineSum / baselineValues.length : 0;

    const sourceValues = rows.map(r => Number(r[column])).filter(v => !isNaN(v));
    const sourceSum = sourceValues.reduce((a, b) => a + b, 0);
    const sourceMean = sourceValues.length > 0 ? sourceSum / sourceValues.length : 0;

    const multiplier = 1 + changePercent / 100;

    // Simple proportional impact model
    const projectedSum = baselineSum * multiplier;
    const projectedMean = baselineMean * multiplier;
    const impact = projectedSum - baselineSum;
    const impactPercent = ((projectedSum - baselineSum) / (baselineSum || 1)) * 100;

    // Category breakdown: apply change per category if a category column exists
    const categoryKeywords = [/category/i, /type/i, /status/i, /segment/i, /channel/i, /product/i, /branch/i, /салбар/i, /бүтээгдэхүүн/i];
    const categoryCol = columnList.find(col => categoryKeywords.some(p => p.test(col)));

    let categoryImpact: Array<{ category: string; baseline: number; projected: number; change: number }> = [];
    if (categoryCol) {
      const groups = new Map<string, number[]>();
      rows.forEach(r => {
        const cat = String(r[categoryCol] || "Unknown");
        const val = Number(r[targetColumn]);
        if (!isNaN(val)) {
          const existing = groups.get(cat) || [];
          existing.push(val);
          groups.set(cat, existing);
        }
      });
      for (const [cat, vals] of groups) {
        const catSum = vals.reduce((a, b) => a + b, 0);
        categoryImpact.push({
          category: cat,
          baseline: Math.round(catSum * 100) / 100,
          projected: Math.round(catSum * multiplier * 100) / 100,
          change: Math.round((catSum * multiplier - catSum) * 100) / 100,
        });
      }
      categoryImpact.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
      categoryImpact = categoryImpact.slice(0, 10);
    }

    res.json({
      scenario: {
        name: scenarioName || `${column} ${changePercent > 0 ? "+" : ""}${changePercent}%`,
        column,
        changePercent,
        targetColumn,
        rowsAffected: rows.length,
      },
      baseline: {
        columnSum: Math.round(sourceSum * 100) / 100,
        columnMean: Math.round(sourceMean * 100) / 100,
        targetSum: Math.round(baselineSum * 100) / 100,
        targetMean: Math.round(baselineMean * 100) / 100,
      },
      projected: {
        targetSum: Math.round(projectedSum * 100) / 100,
        targetMean: Math.round(projectedMean * 100) / 100,
      },
      impact: {
        absolute: Math.round(impact * 100) / 100,
        percent: Math.round(impactPercent * 100) / 100,
      },
      categoryImpact,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// Dashboard — Computed Metrics (AOV, Growth Rate, Top Category)
// ─────────────────────────────────────────────────────────────
app.get("/api/dashboard/computed-metrics", async (req, res) => {
  const { startDate, endDate } = extractDateFilter(req);

  try {
    const metrics = await computeMetrics(getUserId(req), startDate, endDate);
    if (!metrics) return res.status(404).json({ error: "No active dataset found" });
    res.json(metrics);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// Finance Default Charts
// ─────────────────────────────────────────────────────────────
app.get("/api/finance-charts", async (req, res) => {
  const userId = getUserId(req);
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
    // Operating expense: exclude loan repayments (%зээл%) and exact noise subcategories
    // (config/noise-subcategories.yml). Uses exact LOWER() match instead of fuzzy %бусад%
    // to avoid dropping legitimate expenses whose name happens to contain "бусад".
    const isOpExpense = qSubCat
      ? `(${qCat} ILIKE '%зарлага%' AND ${qSubCat} NOT ILIKE '%зээл%' AND ${buildNoiseSubcategoryFilter(qSubCat)})`
      : `${qCat} ILIKE '%зарлага%'`;
    // Noise filter: exclude internal transfers and owner loans (Дотоод шилжүүлэг, Эздийн зээл)
    const notNoise = `${qCat} NOT ILIKE '%шилжүүлэг%' AND ${qCat} NOT ILIKE '%эздийн зээл%'`;

    const charts: Array<{ id: string; title: string; type?: string; data: Array<Record<string, unknown>>; config?: Record<string, unknown> }> = [];

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
          data: r.rows.map((row: Record<string, unknown>) => ({ label: String(row.label ?? ""), value: Number(row.value ?? 0) })),
          config: { xAxis: "label", yAxis: "value" },
        });
      }
    } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }

    // Helper: format "YYYY-MM" → "N-р сар"
    function formatMonthLabel(yyyyMM: string): string {
      const m = parseInt((yyyyMM || "").split("-")[1] || "1", 10);
      return `${m}-р сар`;
    }

    // 2. Monthly cashflow — operating income vs operating expense (grouped bar)
    if (dateCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const r = await pool.query(`
          SELECT
            TO_CHAR(${qDate}::DATE, 'YYYY-MM') AS label,
            SUM(CASE WHEN ${isOpIncome}  THEN ${qAmt} ELSE 0 END) AS "Орлого",
            SUM(CASE WHEN ${isOpExpense} THEN ${qAmt} ELSE 0 END) AS "Зарлага"
          FROM ${qTbl}
          WHERE ${qDate} IS NOT NULL AND ${notNoise}
          GROUP BY 1 ORDER BY 1
        `);
        if (r.rows.length > 0) {
          charts.push({
            id: "monthly_cashflow",
            title: "Сарын орлого / зарлага",
            type: "bar",
            data: r.rows.map((row: Record<string, unknown>) => ({
              label: formatMonthLabel(String(row.label ?? "")),
              "Орлого": Number(row["Орлого"] ?? 0),
              "Зарлага": Number(row["Зарлага"] ?? 0),
            })),
            config: { xAxis: "label", yAxis: "value", series: ["Орлого", "Зарлага"], stacked: false },
          });
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
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
            data: r.rows.map((row: Record<string, unknown>) => ({ label: String(row.label ?? ""), value: Number(row.value ?? 0) })),
            config: { xAxis: "label", yAxis: "value" },
          });
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // 4. Daily net cashflow (line) — income minus operating expense per day
    if (dateCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const r = await pool.query(`
          SELECT
            TO_CHAR(${qDate}::DATE, 'MM/DD') AS label,
            SUM(CASE WHEN ${isOpIncome}  THEN ${qAmt} ELSE 0 END) -
            SUM(CASE WHEN ${isOpExpense} THEN ${qAmt} ELSE 0 END) AS value
          FROM ${qTbl}
          WHERE ${qDate} IS NOT NULL AND ${notNoise}
          GROUP BY 1, ${qDate}::DATE ORDER BY ${qDate}::DATE
        `);
        if (r.rows.length > 0) {
          charts.push({
            id: "daily_trend",
            title: "Өдрийн цэвэр орлого",
            type: "line",
            data: r.rows.map((row: Record<string, unknown>) => ({ label: String(row.label ?? ""), value: Number(row.value ?? 0) })),
            config: { xAxis: "label", yAxis: "value" },
          });
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // 5. Monthly operating profit/loss
    if (dateCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const r = await pool.query(`
          SELECT
            TO_CHAR(${qDate}::DATE, 'YYYY-MM') AS label,
            SUM(CASE WHEN ${isOpIncome}  THEN ${qAmt} ELSE 0 END) -
            SUM(CASE WHEN ${isOpExpense} THEN ${qAmt} ELSE 0 END) AS value
          FROM ${qTbl}
          WHERE ${notNoise} AND ${qDate} IS NOT NULL
          GROUP BY 1 ORDER BY 1
        `);
        if (r.rows.length > 0) {
          charts.push({
            id: "monthly_profit",
            title: "Сарын үйл ажиллагааны ашиг/алдагдал",
            type: "bar",
            data: r.rows.map((row: Record<string, unknown>) => ({
              label: formatMonthLabel(String(row.label ?? "")),
              value: Number(row.value ?? 0),
            })),
            config: { xAxis: "label", yAxis: "value" },
          });
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // 6. Monthly expense breakdown by subcategory (stacked bar)
    if (dateCol && subCatCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const qSub  = quoteIdent(subCatCol);
        const r = await pool.query(`
          SELECT
            TO_CHAR(${qDate}::DATE, 'YYYY-MM') AS month,
            ${qSub} AS subcat,
            SUM(${qAmt}) AS total
          FROM ${qTbl}
          WHERE ${isOpExpense} AND ${qSub} IS NOT NULL AND ${qDate} IS NOT NULL
          GROUP BY 1, 2
          ORDER BY 1
        `);
        if (r.rows.length > 0) {
          // Find top 5 subcats by total amount
          const subcatTotals: Record<string, number> = {};
          for (const row of r.rows as Record<string, unknown>[]) {
            const s = String(row.subcat ?? "");
            subcatTotals[s] = (subcatTotals[s] || 0) + Number(row.total ?? 0);
          }
          const topSubcats = Object.entries(subcatTotals)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([k]) => k);

          // Pivot: month → { label, subcat1: total, subcat2: total, ... }
          const monthMap: Record<string, Record<string, number>> = {};
          for (const row of r.rows as Record<string, unknown>[]) {
            const m = String(row.month ?? "");
            const s = String(row.subcat ?? "");
            if (!topSubcats.includes(s)) continue;
            if (!monthMap[m]) monthMap[m] = {};
            monthMap[m][s] = Number(row.total ?? 0);
          }

          const pivotData = Object.entries(monthMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, vals]) => {
              const entry: Record<string, string | number> = { label: formatMonthLabel(month) };
              for (const s of topSubcats) {
                entry[s] = vals[s] || 0;
              }
              return entry;
            });

          charts.push({
            id: "expense_breakdown_monthly",
            title: "Зарлагын бүтэц сараар",
            type: "stacked_bar",
            data: pivotData,
            config: { xAxis: "label", yAxis: "value", series: topSubcats, stacked: true },
          });
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // ── 7. Cashflow summary: operating items per month ──
    if (dateCol && subCatCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const r = await pool.query(`
          SELECT
            TO_CHAR(${qDate}::DATE, 'YYYY-MM') AS month,
            ${qCat} AS category,
            ${qSubCat} AS subcat,
            SUM(${qAmt}) AS total
          FROM ${qTbl}
          WHERE ${notNoise}
            AND (${isOpIncome} OR ${isOpExpense})
            AND ${qDate} IS NOT NULL
          GROUP BY 1, 2, 3
          ORDER BY 1, 3
        `);
        if (r.rows.length > 0) {
          const monthBuckets: Record<string, Record<string, number>> = {};
          for (const row of r.rows as Record<string, unknown>[]) {
            const m = String(row.month ?? "");
            const sub = String(row.subcat ?? "");
            if (!monthBuckets[m]) monthBuckets[m] = {};
            monthBuckets[m][sub] = (monthBuckets[m][sub] || 0) + Number(row.total ?? 0);
          }
          // Gather all unique subcategories
          const allSubcats = [...new Set(r.rows.map((row: Record<string, unknown>) => String(row.subcat ?? "")))];
          const pivotData = Object.entries(monthBuckets)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, vals]) => {
              const entry: Record<string, string | number> = { label: formatMonthLabel(month) };
              for (const s of allSubcats) entry[s] = vals[s] || 0;
              return entry;
            });
          if (pivotData.length > 0) {
            charts.push({
              id: "cashflow_summary",
              title: "Мөнгөн урсгалын дэлгэрэнгүй — сараар",
              type: "stacked_bar",
              data: pivotData,
              config: { xAxis: "label", yAxis: "value", series: allSubcats, stacked: true },
            });
          }
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // ── 8. Income statement: income vs expense totals by subcategory ──
    if (subCatCol) {
      try {
        const r = await pool.query(`
          SELECT
            CASE WHEN ${isOpIncome} THEN 'Орлого' ELSE 'Зарлага' END AS section,
            ${qSubCat} AS subcat,
            SUM(${qAmt}) AS total
          FROM ${qTbl}
          WHERE ${notNoise} AND (${isOpIncome} OR ${isOpExpense})
            AND ${qSubCat} IS NOT NULL
          GROUP BY 1, 2
          ORDER BY 1, 3 DESC
        `);
      if (r.rows.length > 0) {
        const incomeRows = r.rows.filter((row: Record<string, unknown>) => row.section === "Орлого");
        const expenseRows = r.rows.filter((row: Record<string, unknown>) => row.section === "Зарлага");
        const topIncome = incomeRows.slice(0, 5);
        const topExpense = expenseRows.slice(0, 5);
        const labels = [...new Set([...topIncome.map((r: Record<string, unknown>) => String(r.subcat)), ...topExpense.map((r: Record<string, unknown>) => String(r.subcat))])];
        const incomeMap: Record<string, number> = {};
        const expenseMap: Record<string, number> = {};
        for (const r of topIncome) incomeMap[String(r.subcat)] = Number(r.total);
        for (const r of topExpense) expenseMap[String(r.subcat)] = Number(r.total);
        const barData = labels.map(l => ({
          label: l,
          Орлого: incomeMap[l] || 0,
          Зарлага: expenseMap[l] || 0,
        }));
        charts.push({
          id: "income_statement",
          title: "Орлого / Зарлагын төрлөөр",
          type: "bar",
          data: barData,
          config: { xAxis: "label", yAxis: "value", series: ["Орлого", "Зарлага"], stacked: false },
        });
      }
    } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // ── 9. Expense category stats with percentages ──
    if (subCatCol) {
      try {
        const r = await pool.query(`
          SELECT
            ${qSubCat} AS subcat,
            SUM(${qAmt}) AS total
          FROM ${qTbl}
          WHERE ${isOpExpense} AND ${qSubCat} IS NOT NULL
          GROUP BY 1
          ORDER BY 2 DESC
        `);
        if (r.rows.length > 0) {
          const totalExp = r.rows.reduce((s: number, row: any) => s + Number(row.total ?? 0), 0);
          const data = r.rows.map((row: Record<string, unknown>) => ({
            label: String(row.subcat ?? ""),
            value: Number(row.total ?? 0),
            pct: totalExp > 0 ? Math.round((Number(row.total ?? 0) / totalExp) * 1000) / 10 : 0,
          }));
          charts.push({
            id: "expense_category_stats",
            title: "Зарлагын ангилал — дүн ба хувь",
            type: "horizontal_bar",
            data,
            config: {
              xAxis: "label",
              yAxis: "value",
              description: "Үйл ажиллагааны зарлагыг дэд ангилалаар хувийн жинтэй нь харуулна",
            },
          });
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // Compute P&L summary
    const summaryRes = await pool.query(`
      SELECT
        SUM(CASE WHEN ${isOpIncome}  THEN ${qAmt} ELSE 0 END) AS total_income,
        SUM(CASE WHEN ${isOpExpense} THEN ${qAmt} ELSE 0 END) AS total_expense,
        COUNT(*) FILTER (WHERE ${notNoise}) AS total_transactions
      FROM ${qTbl}
    `);
    const totalIncome       = Math.round(Number(summaryRes.rows[0]?.total_income    || 0));
    const totalExpense      = Math.round(Number(summaryRes.rows[0]?.total_expense   || 0));
    const totalTransactions = Number(summaryRes.rows[0]?.total_transactions || 0);
    const operatingProfit   = totalIncome - totalExpense;

    let period = "";
    if (dateCol) {
      try {
        const qDate = quoteIdent(dateCol);
        const pr = await pool.query(`
          SELECT
            EXTRACT(YEAR  FROM MIN(${qDate}::DATE)) AS min_year,
            EXTRACT(YEAR  FROM MAX(${qDate}::DATE)) AS max_year,
            EXTRACT(QUARTER FROM MIN(${qDate}::DATE)) AS min_q,
            EXTRACT(QUARTER FROM MAX(${qDate}::DATE)) AS max_q
          FROM ${qTbl}
          WHERE ${qDate} IS NOT NULL AND ${qDate} != ''
        `);
        const row = pr.rows[0];
        const minY = row?.min_year;
        const maxY = row?.max_year;
        const minQ = row?.min_q;
        const maxQ = row?.max_q;
        if (minY != null && maxY != null) {
          if (minY === maxY) {
            if (minQ != null && minQ === maxQ) {
              period = `Q${minQ} ${minY}`;
            } else {
              period = `${minY} (Q${minQ}–Q${maxQ})`;
            }
          } else {
            period = `${minY}–${maxY}`;
          }
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    return res.json({
      isFinance: charts.length > 0,
      tableName: table,
      charts,
      period,
      summary: { totalIncome, totalExpense, operatingProfit, totalTransactions },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// Finance Audit — row-level classification breakdown for transparency
// ─────────────────────────────────────────────────────────────
app.get("/api/finance-audit", async (req, res) => {
  const userId = getUserId(req);

  try {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: "DB unavailable" });

    const entry = await getActiveCatalogEntry(userId);
    if (!entry) return res.json({ available: false });

    const table    = entry.table_name;
    const columns: string[] = JSON.parse(entry.columns_info);
    const catCol   = findConceptColumn(columns, "finance_category",    table);
    const subCatCol = findConceptColumn(columns, "finance_subcategory", table);
    const amtCol   = findConceptColumn(columns, "finance_amount",       table);

    if (!catCol || !amtCol) return res.json({ available: false });

    const qCat    = quoteIdent(catCol);
    const qSubCat = subCatCol ? quoteIdent(subCatCol) : null;
    const qAmt    = buildMntAmountExpr(quoteIdent(amtCol));
    const qTbl    = quoteIdent(table);

    const noiseFilter = buildNoiseSubcategoryFilter(qSubCat ?? qCat);
    const isOpIncome  = `(${qCat} ILIKE '%орлого%' AND ${qCat} NOT ILIKE '%зээл%')`;
    const isOpExpense = qSubCat
      ? `(${qCat} ILIKE '%зарлага%' AND ${qSubCat} NOT ILIKE '%зээл%' AND ${noiseFilter})`
      : `${qCat} ILIKE '%зарлага%'`;
    const isNoise = `(${qCat} ILIKE '%шилжүүлэг%' OR ${qCat} ILIKE '%эздийн зээл%'${qSubCat ? ` OR (${qCat} ILIKE '%зарлага%' AND NOT ${noiseFilter})` : ""})`;

    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE ${isOpIncome})                         AS income_rows,
        COUNT(*) FILTER (WHERE ${isOpExpense})                        AS expense_rows,
        COUNT(*) FILTER (WHERE ${isNoise})                            AS noise_rows,
        COUNT(*) FILTER (WHERE NOT ${isOpIncome} AND NOT ${isOpExpense} AND NOT ${isNoise}) AS unclassified_rows,
        COUNT(*)                                                       AS total_rows,
        COALESCE(SUM(${qAmt}) FILTER (WHERE ${isOpIncome}),  0)      AS income_total,
        COALESCE(SUM(${qAmt}) FILTER (WHERE ${isOpExpense}), 0)      AS expense_total
      FROM ${qTbl}
    `);

    const row = result.rows[0];
    return res.json({
      available: true,
      tableName: table,
      incomeRows:       Number(row.income_rows),
      expenseRows:      Number(row.expense_rows),
      noiseRows:        Number(row.noise_rows),
      unclassifiedRows: Number(row.unclassified_rows),
      totalRows:        Number(row.total_rows),
      incomeTotal:      Math.round(Number(row.income_total)),
      expenseTotal:     Math.round(Number(row.expense_total)),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// Table Passport — data-driven suggestion questions from DataProfiler
// ─────────────────────────────────────────────────────────────
app.get("/api/table-passport", async (req, res) => {
  try {
    const entry = await getActiveCatalogEntry(getUserId(req));
    if (!entry) return res.json({ available: false });

    const tableName = entry.table_name;
    const markdown = await getPassportByTableName(tableName);
    if (!markdown) return res.json({ available: false, tableName });

    const questions = parsePassportQuestions(markdown);
    const domainMatch = markdown.match(/\*\*Домэйн\*\*:\s*(.+)/);
    const industryMatch = markdown.match(/\*\*Салбар\*\*:\s*(.+)/);

    return res.json({
      available: questions.length > 0,
      tableName,
      questions,
      domain: domainMatch?.[1]?.trim() ?? "",
      industry: industryMatch?.[1]?.trim() ?? "",
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// Finance Detailed Reports — Income Statement, Expense Breakdown, Cash Flow
// ─────────────────────────────────────────────────────────────
app.get("/api/finance-reports", async (req, res) => {
  const userId = getUserId(req);
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

    if (!amtCol || !catCol) return res.json({ isFinance: false });

    const qAmt    = buildMntAmountExpr(quoteIdent(amtCol));
    const qCat    = quoteIdent(catCol);
    const qSubCat = subCatCol ? quoteIdent(subCatCol) : null;
    const qDate   = dateCol  ? quoteIdent(dateCol) : null;
    const qTbl    = quoteIdent(table);

    const isOpIncome  = `(${qCat} ILIKE '%орлого%' AND ${qCat} NOT ILIKE '%зээл%')`;
    const isOpExpense = qSubCat
      ? `(${qCat} ILIKE '%зарлага%' AND ${qSubCat} NOT ILIKE '%зээл%' AND ${buildNoiseSubcategoryFilter(qSubCat)})`
      : `${qCat} ILIKE '%зарлага%'`;
    const notNoise = `${qCat} NOT ILIKE '%шилжүүлэг%' AND ${qCat} NOT ILIKE '%эздийн зээл%'`;

    // ── 1. Income Statement (Орлого зарлагын тайлан) ──
    let incomeStatement = null;
    if (subCatCol) {
      try {
        const r = await pool.query(`
          SELECT
            CASE WHEN ${isOpIncome} THEN 'Орлого' ELSE 'Зарлага' END AS section,
            ${qSubCat} AS subcat,
            SUM(${qAmt}) AS total
          FROM ${qTbl}
          WHERE ${notNoise} AND (${isOpIncome} OR ${isOpExpense})
            AND ${qSubCat} IS NOT NULL
          GROUP BY 1, 2
          ORDER BY 1, 3 DESC
        `);
        if (r.rows.length > 0) {
          const incomeRows = r.rows
            .filter((row: Record<string, unknown>) => row.section === "Орлого")
            .map((row: Record<string, unknown>) => ({ subcategory: String(row.subcat ?? ""), amount: Math.round(Number(row.total ?? 0)) }));
          const expenseRows = r.rows
            .filter((row: Record<string, unknown>) => row.section === "Зарлага")
            .map((row: Record<string, unknown>) => ({ subcategory: String(row.subcat ?? ""), amount: Math.round(Number(row.total ?? 0)) }));
          const totalIncomeVal = incomeRows.reduce((s: number, r: any) => s + r.amount, 0);
          const totalExpenseVal = expenseRows.reduce((s: number, r: any) => s + r.amount, 0);
          incomeStatement = {
            incomeRows,
            expenseRows,
            totalIncome: totalIncomeVal,
            totalExpense: totalExpenseVal,
            operatingProfit: totalIncomeVal - totalExpenseVal,
          };
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // ── 2. Expense Breakdown with Monthly Pivot (Зардлын задаргаа) ──
    let expenseBreakdown = null;
    if (subCatCol && dateCol) {
      try {
        const qD = quoteIdent(dateCol);
        const r = await pool.query(`
          SELECT
            ${qSubCat} AS subcat,
            TO_CHAR(${qD}::DATE, 'YYYY-MM') AS month,
            SUM(${qAmt}) AS total
          FROM ${qTbl}
          WHERE ${isOpExpense} AND ${qSubCat} IS NOT NULL AND ${qD} IS NOT NULL
          GROUP BY 1, 2
          ORDER BY 1, 2
        `);
        if (r.rows.length > 0) {
          // Aggregate by subcategory and month
          const subcatTotals: Record<string, number> = {};
          const monthMap: Record<string, Record<string, number>> = {};
          const monthSet = new Set<string>();
          for (const row of r.rows as Record<string, unknown>[]) {
            const s = String(row.subcat ?? "");
            const m = String(row.month ?? "");
            const v = Math.round(Number(row.total ?? 0));
            subcatTotals[s] = (subcatTotals[s] || 0) + v;
            if (!monthMap[s]) monthMap[s] = {};
            monthMap[s][m] = (monthMap[s][m] || 0) + v;
            monthSet.add(m);
          }

          // Sort subcategories by total descending
          const sortedSubcats = Object.entries(subcatTotals)
            .sort((a, b) => b[1] - a[1])
            .map(([k]) => k);

          // Sort months
          const sortedMonths = [...monthSet].sort();

          const grandTotal = sortedSubcats.reduce((s, c) => s + (subcatTotals[c] || 0), 0);

          const rows = sortedSubcats.map(cat => {
            const monthly = sortedMonths.map(m => monthMap[cat]?.[m] ?? 0);
            const total = subcatTotals[cat] || 0;
            const pct = grandTotal > 0 ? Math.round((total / grandTotal) * 1000) / 10 : 0;
            return { category: cat, monthly, total, pct };
          });

          const monthLabels = sortedMonths.map((m) => {
            const parts = m.split("-");
            return `${parseInt(parts[1], 10)}-р сар`;
          });

          expenseBreakdown = { categories: sortedSubcats, months: monthLabels, rows, grandTotal };
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    // ── 3. Cash Flow (Мөнгөн урсгал) ──
    let cashFlow = null;
    if (subCatCol) {
      try {
        // Income items (operating) + financing items (loans, investments) as inflows
        // Expense items as outflows
        const r = await pool.query(`
          SELECT
            ${qSubCat} AS subcat,
            SUM(${qAmt}) AS total,
            CASE
              WHEN ${isOpIncome} THEN 'inflow'
              WHEN ${qCat} ILIKE '%зээл%' OR ${qCat} ILIKE '%хөрөнгө оруулалт%' THEN 'financing'
              WHEN ${isOpExpense} THEN 'outflow'
              ELSE 'other'
            END AS flow_type
          FROM ${qTbl}
          WHERE ${qSubCat} IS NOT NULL AND ${qCat} NOT ILIKE '%шилжүүлэг%'
          GROUP BY 1, flow_type
          ORDER BY flow_type, 2 DESC
        `);
        if (r.rows.length > 0) {
          const inflowRows = r.rows
            .filter((row: Record<string, unknown>) => row.flow_type === "inflow")
            .map((row: Record<string, unknown>) => ({ name: String(row.subcat ?? ""), amount: Math.round(Number(row.total ?? 0)) }));
          const financingRows = r.rows
            .filter((row: Record<string, unknown>) => row.flow_type === "financing")
            .map((row: Record<string, unknown>) => ({ name: String(row.subcat ?? ""), amount: Math.round(Number(row.total ?? 0)) }));
          const outflowRows = r.rows
            .filter((row: Record<string, unknown>) => row.flow_type === "outflow")
            .map((row: Record<string, unknown>) => ({ name: String(row.subcat ?? ""), amount: Math.round(Number(row.total ?? 0)) }));
          const otherRows = r.rows
            .filter((row: Record<string, unknown>) => row.flow_type === "other")
            .map((row: Record<string, unknown>) => ({ name: String(row.subcat ?? ""), amount: Math.round(Number(row.total ?? 0)) }));

          const sections: Array<{ name: string; items: Array<{ name: string; amount: number }>; subtotal: number }> = [];
          if (inflowRows.length > 0) {
            sections.push({
              name: "Үйл ажиллагааны орлого",
              items: inflowRows,
              subtotal: inflowRows.reduce((s: number, r: any) => s + Math.abs(r.amount), 0),
            });
          }
          if (financingRows.length > 0) {
            sections.push({
              name: "Санхүүжилт",
              items: financingRows,
              subtotal: financingRows.reduce((s: number, r: any) => s + Math.abs(r.amount), 0),
            });
          }
          if (outflowRows.length > 0) {
            sections.push({
              name: "Үйл ажиллагааны зарлага",
              items: outflowRows,
              subtotal: -outflowRows.reduce((s: number, r: any) => s + Math.abs(r.amount), 0),
            });
          }
          if (otherRows.length > 0) {
            sections.push({
              name: "Бусад",
              items: otherRows,
              subtotal: otherRows.reduce((s: number, r: any) => s + r.amount, 0),
            });
          }

          const totalInflow = inflowRows.reduce((s: number, r: any) => s + r.amount, 0)
            + financingRows.reduce((s: number, r: any) => s + r.amount, 0);
          const totalOutflow = outflowRows.reduce((s: number, r: any) => s + r.amount, 0);
          const netCashFlow = totalInflow - totalOutflow;

          cashFlow = { sections, netCashFlow };
        }
      } catch (e) { console.warn("[chart-skip]", e instanceof Error ? e.message : e); }
    }

    return res.json({
      isFinance: !!(incomeStatement || expenseBreakdown || cashFlow),
      incomeStatement,
      expenseBreakdown,
      cashFlow,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// Report Export — PDF / Excel (JWT-scoped userId)
// ─────────────────────────────────────────────────────────────
app.post("/api/report/export-pdf", async (req, res) => {
  const { startDate, endDate } = extractDateFilter(req);

  try {
    const pdfBuffer = await generateReportPdf(getUserId(req), startDate, endDate);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report-${new Date().toISOString().split("T")[0]}.pdf"`);
    res.send(pdfBuffer);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

app.post("/api/report/export-xlsx", async (req, res) => {
  const { startDate, endDate } = extractDateFilter(req);

  try {
    const xlsxBuffer = await generateReportXlsx(getUserId(req), startDate, endDate);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="report-${new Date().toISOString().split("T")[0]}.xlsx"`);
    res.send(xlsxBuffer);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// File Management
// ─────────────────────────────────────────────────────────────
app.get("/api/admin/files", async (req, res) => {
  await initDataLake();
  const result = await getPool().query(`SELECT * FROM uploaded_files ORDER BY created_at DESC`);
  res.json(result.rows);
});

app.delete("/api/admin/files/:id", requireAuth, requirePermission("admin:upload"), async (req, res) => {
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

app.get("/api/admin/files/:id/preview", async (req, res) => {
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
  } catch (err: unknown) {
    console.error(`[API] Preview failed for file ${id}:`, err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: err instanceof Error ? err.message : "Preview failed" });
  }
});

app.get("/api/admin/files/:id/download", async (req, res) => {
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
app.post("/api/admin/upload-csv", requireAuth, requirePermission("admin:upload"), async (req, res) => {
  const userId = getUserId(req);
  const role = getRole(req);

  // Rate limit uploads per user
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

// ─────────────────────────────────────────────────────────────
// Admin: Upload Excel (XLSX/XLS)
// ─────────────────────────────────────────────────────────────
app.post("/api/admin/upload-excel", requireAuth, requirePermission("admin:upload"), upload.single("file"), async (req, res) => {
  const userId = getUserId(req);
  const role = getRole(req);

  // Rate limit uploads per user
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
    // Read all rows as raw arrays to skip title/blank rows and find the real header row
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

// ─────────────────────────────────────────────────────────────
// Admin: Upload Document (PDF/DOCX)
// ─────────────────────────────────────────────────────────────
const DOCUMENTS_DIR = "uploads/documents/";
if (!fs.existsSync(DOCUMENTS_DIR)) {
  fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
}

app.post("/api/admin/upload-doc", requireAuth, requirePermission("admin:upload"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  // Rate limit uploads per user
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

    // Save original file permanently
    await fs.promises.rename(tempPath, savedPath);
    // Save extracted text
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

    // Do NOT add to RAG automatically. It must be approved by admin.

    console.log(`[Feedback] ${rating} feedback from ${getUserId(req)}: "${message.slice(0, 80)}..."`);
    const suggestions = rating === "negative"
        ? "Таны санал бүртгэгдлээ. Дараах зүйлсийг санал болгож байна:\n- **Файл оруулах**: Хэрэв өгөгдөл дутуу байвал CSV файлаа upload хийгээрэй\n- **Тодорхой асуулт**: Баганын нэр, огноогоо дурдаж асууна уу\n- **Агент солих**: 'SQL query бич' эсвэл 'борлуулалтын тайлан' гэх мэт чиглэл өгнө үү"
        : "Санал өгсөнд баярлалаа!";
    res.json({ success: true, message: suggestions });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// GET /api/admin/feedback/pending - get pending feedback items
app.get("/api/admin/feedback/pending", async (req, res) => {
  try {
    const all = await readFailedQueries();
    const pending = all.filter((f: any) => f.status === "pending");
    res.json(pending);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// POST /api/admin/feedback/:id/approve - approve a feedback entry and add to RAG
app.post("/api/admin/feedback/:id/approve", requireAuth, requirePermission("admin:users"), async (req, res) => {
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

// POST /api/admin/feedback/:id/reject - reject a feedback entry (do not add to RAG)
app.post("/api/admin/feedback/:id/reject", requireAuth, requirePermission("admin:users"), async (req, res) => {
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

// ─────────────────────────────────────────────────────────────
// Adjust KPI Targets
// ─────────────────────────────────────────────────────────────
app.post("/api/kpi/:metric/target", async (req, res) => {
  const { metric } = req.params;
  const VALID_METRICS = ["sales", "users", "churn_rate"];
  if (!VALID_METRICS.includes(metric)) {
    return res.status(400).json({ error: `Invalid metric '${metric}'. Must be one of: ${VALID_METRICS.join(", ")}` });
  }

  const { target } = req.body;
  
  try {
    const repo = await getRepository();
    await repo.updateKpiTarget(metric as "sales" | "users" | "churn_rate", Number(target));
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// Authentication — Login / Register / Me
// ─────────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  try {
    const user = await authenticateUser(email, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = createToken(user.id, user.role as UserRole);
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Login failed" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: "Email, password, and name are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  try {
    const userId = await createUser(email, password, name);
    if (!userId) {
      return res.status(409).json({ error: "Email already registered" });
    }
    const token = createToken(userId, "viewer");
    res.status(201).json({ success: true, token, user: { id: userId, name, email, role: "viewer" } });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Registration failed" });
  }
});

app.get("/api/auth/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const token = authHeader.slice(7);
  const result = verifyToken(token);
  if (!result.success || !result.payload) {
    return res.status(401).json({ error: result.error || "Invalid token" });
  }
  res.json({ success: true, user: { id: result.payload.userId, role: result.payload.role } });
});

/**
 * @openapi
 * /api/auth/permissions:
 *   get:
 *     tags: [Auth]
 *     summary: Get current user's permissions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User permissions
 */
app.get("/api/auth/permissions", requireAuth, async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  res.json({
    success: true,
    role: user.role,
    permissions: getPermissions(user.role),
  });
});

// ─────────────────────────────────────────────────────────────
// Conversation Persistence — CRUD for chat history
// ─────────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/conversations:
 *   get:
 *     tags: [Conversations]
 *     summary: List user conversations
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of conversations
 */
app.get("/api/conversations", async (req, res) => {
  try {
    const userId = getUserId(req);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const conversations = await getConversations(userId, limit, offset);
    res.json({ success: true, data: conversations });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

app.get("/api/conversations/search", async (req, res) => {
  try {
    const userId = getUserId(req);
    const q = req.query.q as string;
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: "Search query 'q' is required" });
    }
    const conversations = await searchConversations(userId, q, 20);
    res.json({ success: true, data: conversations });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

app.get("/api/conversations/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const conversation = await getConversationById(req.params.id, userId);
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    res.json({ success: true, data: conversation });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

app.get("/api/conversations/:id/messages", async (req, res) => {
  try {
    const userId = getUserId(req);
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const messages = await getMessages(req.params.id, userId, limit, offset);
    res.json({ success: true, data: messages });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

app.post("/api/conversations", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { title, agentType } = req.body;
    const conversation = await createConversation(userId, title, agentType);
    res.status(201).json({ success: true, data: conversation });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

app.delete("/api/conversations/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const deleted = await deleteConversation(req.params.id, userId);
    if (!deleted) return res.status(404).json({ error: "Conversation not found" });
    res.json({ success: true, message: "Conversation deleted" });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

app.patch("/api/conversations/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { title } = req.body;
    if (!title || typeof title !== "string") {
      return res.status(400).json({ error: "Title is required" });
    }
    await updateConversationTitle(req.params.id, userId, title);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─────────────────────────────────────────────────────────────
// ⑦ Export Center
// ─────────────────────────────────────────────────────────────
app.use("/api/export", exportRouter);

// ─────────────────────────────────────────────────────────────
// ① Auto Alert System
// ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/alerts:
 *   get:
 *     summary: Get auto-generated alerts for the dataset
 *     tags: [Alerts]
 *     responses:
 *       200:
 *         description: List of alerts
 */
app.get("/api/alerts", requireAuth, requirePermission("alert:read"), async (req, res) => {
  try {
    const alerts = await scanAlerts();
    res.json({ success: true, data: alerts, count: alerts.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Alert scan failed" });
  }
});

// ─────────────────────────────────────────────────────────────
// Centralized error handler middleware
// ─────────────────────────────────────────────────────────────
app.use((err: Error & { code?: string; statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large. Maximum size is 10MB." });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }
  if (err.message?.startsWith("Unsupported file type")) {
    res.status(415).json({ error: err.message });
    return;
  }
  console.error("[API] Unhandled error:", err);
  const isDev = process.env.NODE_ENV !== "production";
  res.status(500).json({
    error: "Internal server error",
    ...(isDev && { details: err.message, stack: err.stack?.split("\n").slice(0, 5) }),
  });
});

const PORT = process.env.API_PORT || 3001;
async function start() {
  try {
    await ensureProjectReady();
  } catch (err) {
    console.warn("[API] Data Lake initialization failed — running in limited mode:", (err as Error).message);
  }
  await setupKnowledgeBase();

  // Initialize conversation persistence schema
  await initConversationSchema();

  const server = app.listen(PORT, () => {
    console.log(`\nAPI Server running at http://localhost:${PORT}`);
  });

  // ── Graceful Shutdown ──────────────────────────────────────
  const SHUTDOWN_TIMEOUT_MS = 10_000;
  let isShuttingDown = false;

  async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[API] ${signal} received — starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(() => {
      console.log("[API] HTTP server closed");
    });

    // Force shutdown after timeout
    const forceTimer = setTimeout(() => {
      console.error("[API] Forced shutdown — timeout exceeded");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      // Close PostgreSQL pool
      const pool = getPool();
      await pool.end();
      console.log("[API] PostgreSQL pool closed");
    } catch (err) {
      console.error("[API] Error closing PostgreSQL pool:", (err as Error).message);
    }

    clearTimeout(forceTimer);
    console.log("[API] Graceful shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}
if (process.env.NODE_ENV !== "test") {
  start().catch((err) => {
    console.error("Failed to start API server:", err);
    process.exit(1);
  });
}

export { app };
