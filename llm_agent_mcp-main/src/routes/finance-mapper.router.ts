import { Router } from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { upload } from "./shared.js";

const router = Router();

const DATA_DIR = path.resolve("data");
const MAPPER_PY = path.resolve("finance-mapper/mapper.py");
const PYTHON_BIN = path.resolve("finance-mapper/.venv/bin/python");

router.post("/finance-mapper/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const tmpPath = req.file.path;
    const ext = path.extname(req.file.originalname) || ".csv";
    const filePath = tmpPath + ext;

    fs.renameSync(tmpPath, filePath);

    const cwd = path.resolve(".");
    const child = spawn(PYTHON_BIN, [MAPPER_PY, filePath], {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on("close", (code) => {
      fs.unlink(filePath, () => {});

      if (code !== 0) {
        console.error("[finance-mapper] Python stderr:", stderr);
        console.error("[finance-mapper] Python stdout:", stdout);
        res.status(500).json({ error: "Mapping failed", details: stderr || stdout });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        res.json(result);
      } catch {
        res.status(500).json({ error: "Invalid response from mapper", raw: stdout });
      }
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/finance-mapper/text", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "Text input is required" });
      return;
    }

    const cwd = path.resolve(".");
    const child = spawn(PYTHON_BIN, [MAPPER_PY, "--text"], {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Send text via stdin (safe, no shell escaping issues)
    child.stdin.write(text);
    child.stdin.end();

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error("[finance-mapper/text] Python stderr:", stderr);
        console.error("[finance-mapper/text] Python stdout:", stdout);
        res.status(500).json({ error: "Text mapping failed", details: stderr || stdout });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        res.json(result);
      } catch {
        res.status(500).json({ error: "Invalid response from mapper", raw: stdout });
      }
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/finance-mapper/download/:filename", (req, res) => {
  const filename = req.params.filename;

  if (!filename.startsWith("sar_") || !filename.endsWith(".xlsx")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const filePath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.download(filePath, filename);
});

export default router;
