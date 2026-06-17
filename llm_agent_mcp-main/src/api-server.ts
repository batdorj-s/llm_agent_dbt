/**
 * api-server.ts — Express REST API for the Chat UI
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createToken, verifyBearerHeader, verifyToken } from "./auth.js";
import { agentLimiter } from "./rate-limiter.js";
import { detectProvider } from "./llm-provider.js";
import { getRepository } from "./db/kpi-repository.js";
import { setupKnowledgeBase } from "./rag.js";
import { runMultiAgent, runMultiAgentStream, clearConversationMemory } from "./multi-agent.js";
import type { UserRole } from "./multi-agent.js";
import { seedCsv, initDataLake, getCatalog } from "./db/data-lake.js";
import { addDocumentToCatalog } from "./rag.js";
import fs from "fs";
import path from "path";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

dotenv.config();

const app = express();
app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json({ limit: "50mb" }));

// Configure Multer for file uploads
const UPLOAD_DIR = "uploads/";
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const upload = multer({ dest: UPLOAD_DIR });

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
// Auth — Login (Simplified: everyone is admin)
// ─────────────────────────────────────────────────────────────
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const role: UserRole = "admin";
  const token = createToken(email, role);
  res.json({
    token,
    user: { email, role },
    message: `Logged in as ${email}`,
  });
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
    await runMultiAgent(message, role, threadIdFinal, visualRequest);

    res.json({
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
    }, visualRequest);
    res.write(`data: ${JSON.stringify({ type: "done", full: fullResponse, threadId: threadIdFinal })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// ─────────────────────────────────────────────────────────────
// KPI Dashboard Data
// ─────────────────────────────────────────────────────────────
app.get("/api/kpi/:metric", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const { metric } = req.params;
  const repo = await getRepository();

  try {
    const data = await repo.getKpi(metric as any);
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
  const history = await repo.getSalesHistory(limit);
  res.json(history);
});

// ─────────────────────────────────────────────────────────────
// Admin: E2B Python Sandbox Console Execution
// ─────────────────────────────────────────────────────────────
app.post("/api/admin/run-code", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    return res.status(401).json({ error: auth.error });
  }

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "code required" });

  try {
    const { runPythonCode } = await import("./sandbox.js");
    const output = await runPythonCode(code);
    res.json({ output });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// File Management
// ─────────────────────────────────────────────────────────────
app.get("/api/admin/files", (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success) return res.status(401).json({ error: auth.error });

  const db = initDataLake();
  const files = db.prepare(`SELECT * FROM uploaded_files ORDER BY created_at DESC`).all();
  res.json(files);
});

app.delete("/api/admin/files/:id", async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success) return res.status(401).json({ error: auth.error });

  const { id } = req.params;
  const db = initDataLake();

  const file = db.prepare(`SELECT * FROM uploaded_files WHERE id = ?`).get(id) as any;
  if (!file) return res.status(404).json({ error: "File not found" });

  try {
    if (file.type === "dataset") {
      db.prepare(`DROP TABLE IF EXISTS ${file.filename}`).run();
      db.prepare(`DELETE FROM data_lake_catalog WHERE table_name = ?`).run(file.filename);
      await clearConversationMemory();
    }
    db.prepare(`DELETE FROM uploaded_files WHERE id = ?`).run(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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
  const tempFilePath = path.join(process.cwd(), `temp_${Date.now()}_${filename}`);

  try {
    fs.writeFileSync(tempFilePath, csvContent, "utf8");
    seedCsv(tempFilePath, sanitizedTableName, userId || role, description, true);
    await clearConversationMemory();

    const db = initDataLake();
    db.prepare(`INSERT OR REPLACE INTO uploaded_files (id, filename, type, description) VALUES (?, ?, ?, ?)`).run(
        sanitizedTableName, sanitizedTableName, "dataset", description
    );

    const catalog = getCatalog();
    const tableInfo = catalog.find((row: any) => row.table_name === sanitizedTableName) as any;
    
    if (tableInfo) {
      const cols: string[] = JSON.parse(tableInfo.columns_info);
      const formattedCols = cols.map(c => `\`${c}\``).join(", ");
      const ragText = `Data Lake Catalog: The table '${sanitizedTableName}' is loaded into a SQLite database. Columns: ${formattedCols}. Description: ${description}.`;
      await addDocumentToCatalog(`uploaded_${sanitizedTableName}_${Date.now()}`, ragText, { category: "catalog" }, [sanitizedTableName]);
    }

    res.json({ success: true, message: `Table '${sanitizedTableName}' successfully imported.` });
  } catch (err: any) {
    console.error("[API] CSV Upload Error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }
});

// ─────────────────────────────────────────────────────────────
// Admin: Upload Document (PDF/DOCX)
// ─────────────────────────────────────────────────────────────
app.post("/api/admin/upload-doc", upload.single("file"), async (req, res) => {
  const auth = verifyBearerHeader(req.headers.authorization);
  if (!auth.success || !auth.payload) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(401).json({ error: auth.error });
  }

  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const { description, category, department } = req.body;
  const filePath = req.file.path;
  const originalName = req.file.originalname;

  try {
    let extractedText = "";
    const extension = path.extname(originalName).toLowerCase();

    if (extension === ".pdf") {
      const dataBuffer = fs.readFileSync(filePath);
      const parser = new PDFParse({ data: dataBuffer });
      const result = await parser.getText();
      extractedText = result.text;
    } else if (extension === ".docx") {
      const result = await mammoth.extractRawText({ path: filePath });
      extractedText = result.value;
    } else {
      throw new Error("Unsupported file format.");
    }

    const docId = `doc_${Date.now()}`;
    await addDocumentToCatalog(
        docId, 
        `Document: ${originalName}\nDescription: ${description}\n\nContent:\n${extractedText}`,
        { category: category || "manual", department: department || "general", uploadedBy: auth.payload.userId },
        [originalName.toLowerCase(), "document"]
    );

    const db = initDataLake();
    db.prepare(`INSERT OR REPLACE INTO uploaded_files (id, filename, type, description) VALUES (?, ?, ?, ?)`).run(
        docId, originalName, "document", description
    );

    res.json({ success: true, message: `Document '${originalName}' indexed.` });
  } catch (err: any) {
    console.error("[API] Doc Upload Error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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
  const { target } = req.body;
  
  try {
    const repo = await getRepository();
    await repo.updateKpiTarget(metric as any, Number(target));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.API_PORT || 3001;
async function start() {
  await setupKnowledgeBase();
  app.listen(PORT, () => {
    console.log(`\n🚀 API Server running at http://localhost:${PORT}`);
  });
}
start().catch(console.error);
