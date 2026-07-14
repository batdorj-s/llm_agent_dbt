/**
 * api-server.ts — Express REST API for the Chat UI
 *
 * Route modules:
 *   /api/chat/*      → src/routes/chat.router.ts
 *   /api/auth/*      → src/routes/auth.router.ts
 *   /api/kpi/*       → src/routes/kpi.router.ts
 *   /api/finance-*   → src/routes/finance.router.ts
 *   /api/dashboard/* → src/routes/dashboard.router.ts
 *   /api/alerts      → src/routes/alerts.router.ts
 *   /api/whatif      → src/routes/whatif.router.ts
 *   /api/conversations/* → src/routes/conversations.router.ts
 *   /api/admin/*     → src/routes/admin.router.ts
 *   /api/export/*    → src/routes/export.router.ts
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { chatRouter } from "./routes/chat.router.js";
import { requestContext } from "./context.js";
import helmet from "helmet";
import { detectProvider } from "./llm-provider.js";
import { RateLimiter } from "./rate-limiter.js";
import { authLimiter, mcpLimiter } from "./rate-limiter.js";
import { getPool } from "./db/data-lake.js";
import { setupKnowledgeBase } from "./rag.js";
import { ensureProjectReady } from "./setup/init.js";
import { requireAuth } from "./auth.js";
import { initConversationSchema } from "./services/conversation.js";
import { log } from "./routes/shared.js";
import { REQUEST_TIMEOUT_MS } from "./routes/shared.js";
import authRouter from "./routes/auth.router.js";
import kpiRouter from "./routes/kpi.router.js";
import financeRouter from "./routes/finance.router.js";
import dashboardRouter from "./routes/dashboard.router.js";
import alertsRouter from "./routes/alerts.router.js";
import whatifRouter from "./routes/whatif.router.js";
import conversationsRouter from "./routes/conversations.router.js";
import adminRouter from "./routes/admin.router.js";
import feedbackRouter from "./routes/feedback.router.js";
import exportRouter from "./routes/export.router.js";
import metricsRouter from "./routes/metrics.router.js";
import glossaryRouter from "./routes/glossary.router.js";
import dataQualityRouter from "./routes/data-quality.router.js";
import lineageRouter from "./routes/lineage.router.js";
import apiKeysRouter from "./routes/api-keys.router.js";
import schedulerRouter from "./routes/scheduler.router.js";
import sharingRouter from "./routes/sharing.router.js";
import unifiedSearchRouter from "./routes/unified-search.router.js";
import notificationRouter from "./routes/notification.router.js";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
app.use(express.json({ limit: "5mb" }));

// Rate limiter middleware — applies to all /api/* routes
const apiLimiter = new RateLimiter({ maxRequests: 120, windowMs: 60_000 });
app.use("/api", async (req, res, next) => {
  const key = `api:${(req as any).user?.userId || req.ip || "anon"}`;
  const result = await apiLimiter.check(key);
  res.setHeader("X-RateLimit-Limit", "120");
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  if (!result.allowed) {
    res.status(429).json({ error: result.message });
    return;
  }
  next();
});

const authEndpointLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });
app.use("/api/auth/login", async (req, res, next) => {
  const key = `auth:${req.ip}`;
  const result = await authEndpointLimiter.check(key);
  if (!result.allowed) {
    res.status(429).json({ error: result.message });
    return;
  }
  next();
});

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
app.use(requestTimeout);

// Request logging middleware
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
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./src/api-server.ts"],
});

// ── Swagger UI ───────────────────────────────────────────────
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: "Шинжээч.ai API Docs",
  customCss: ".swagger-ui .topbar { display: none }",
}));
app.get("/api-docs.json", (_req, res) => { res.json(swaggerSpec); });

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
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    checks.postgresql = "ok";
  } catch { checks.postgresql = "unavailable"; }
  try {
    const ragModule = await import("./rag.js");
    const client = (ragModule as any).chromaClient;
    if (client && typeof client.heartbeat === "function") {
      await client.heartbeat();
      checks.chromadb = "ok";
    } else { checks.chromadb = "unavailable"; }
  } catch { checks.chromadb = "unavailable"; }

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

app.get("/api/status", (_req, res) => {
  const provider = detectProvider();
  res.json({
    status: "ok",
    llm: { provider: provider.provider, model: provider.model, isFree: provider.isFree, rateLimit: provider.rateLimit },
    timestamp: new Date().toISOString(),
  });
});

// ── Feature routers ──────────────────────────────────────────
app.use("/api/chat",        chatRouter);
app.use("/api/auth",        authRouter);
app.use("/api",             kpiRouter);       // /api/kpi/:metric, /api/kpi-history
app.use("/api/finance-charts", financeRouter);
app.use("/api/finance-audit",  financeRouter);
app.use("/api/table-passport", financeRouter);
app.use("/api/finance-reports", financeRouter);
app.use("/api/dashboard",   dashboardRouter);
app.use("/api",             dashboardRouter);   // /api/computed-metrics, /api/export-pdf|export-xlsx
app.use("/api/report",      dashboardRouter);   // /api/report/export-pdf|export-xlsx
app.use("/api/alerts",      alertsRouter);
app.use("/api/whatif",      whatifRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/admin",       adminRouter);
app.use("/api/feedback",    feedbackRouter);
app.use("/api/export",      exportRouter);
app.use("/api/metrics",     metricsRouter);
app.use("/api",             glossaryRouter);       // /api/glossary
app.use("/api",             dataQualityRouter);    // /api/data-quality/*
app.use("/api",             lineageRouter);        // /api/lineage
app.use("/api",             apiKeysRouter);        // /api/admin/api-keys
app.use("/api",             schedulerRouter);      // /api/scheduler
app.use("/api",             sharingRouter);        // /api/teams, /api/sharing
app.use("/api",             unifiedSearchRouter);  // /api/search
app.use("/api",             notificationRouter);   // /api/notifications/*

// ── Production security hardening ──────────────────────────
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// ─────────────────────────────────────────────────────────────
// Centralized error handler
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

// ─────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────
// ── Production env validation ──────────────────────────────
function validateEnv(): string[] {
  const warnings: string[] = [];
  if (!process.env.DATABASE_URL) warnings.push("DATABASE_URL not set");
  if (!process.env.JWT_SECRET) warnings.push("JWT_SECRET not set — using insecure dev fallback");
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) warnings.push("No LLM API key set (OPENAI_API_KEY or GEMINI_API_KEY)");
  if (process.env.NODE_ENV === "production") {
    if (!process.env.CORS_ORIGIN) warnings.push("CORS_ORIGIN not set in production");
    if (!process.env.REDIS_URL) warnings.push("REDIS_URL not set — rate limiter uses in-memory store (not safe for multi-instance)");
    if (!process.env.ADMIN_PASSWORD) warnings.push("ADMIN_PASSWORD not set — admin uses random password on first boot");
  }
  return warnings;
}

const PORT = process.env.API_PORT || 3001;
async function start() {
  const envWarnings = validateEnv();
  for (const w of envWarnings) console.warn(`[env] ${w}`);
  try { await ensureProjectReady(); }
  catch (err) {
    console.warn("[API] Data Lake initialization failed — running in limited mode:", (err as Error).message);
  }
  await setupKnowledgeBase();
  await initConversationSchema();

  // Start background scheduler
  const schedulerModule = await import("./services/scheduler.js");
  schedulerModule.startScheduler();
  const _stopScheduler = () => schedulerModule.stopScheduler();

  const server = app.listen(PORT, () => {
    console.log(`\nAPI Server running at http://localhost:${PORT}`);
  });

  const SHUTDOWN_TIMEOUT_MS = 10_000;
  let isShuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[API] ${signal} received — starting graceful shutdown...`);
    if (_stopScheduler) _stopScheduler();
    server.close(() => { console.log("[API] HTTP server closed"); });
    const forceTimer = setTimeout(() => { console.error("[API] Forced shutdown — timeout exceeded"); process.exit(1); }, SHUTDOWN_TIMEOUT_MS);
    try {
      const pool = getPool();
      await pool.end();
      console.log("[API] PostgreSQL pool closed");
    } catch (err) { console.error("[API] Error closing PostgreSQL pool:", (err as Error).message); }
    clearTimeout(forceTimer);
    console.log("[API] Graceful shutdown complete");
    process.exit(0);
  }
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
}

if (process.env.NODE_ENV !== "test") {
  start().catch((err) => { console.error("Failed to start API server:", err); process.exit(1); });
}

export { app };
