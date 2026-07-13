import { Router } from "express";
import { getUserId } from "./shared.js";
import fs from "fs";
import path from "path";

const router = Router();
const FAILED_QUERIES_PATH = path.resolve(process.cwd(), "data", "failed-queries.json");

async function ensureFailedQueriesFile() {
  const dir = path.dirname(FAILED_QUERIES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FAILED_QUERIES_PATH)) fs.writeFileSync(FAILED_QUERIES_PATH, "[]", "utf8");
}

async function readFailedQueries() {
  try {
    const raw = await fs.promises.readFile(FAILED_QUERIES_PATH, "utf8");
    return JSON.parse(raw);
  } catch { return []; }
}

router.post("/", async (req, res) => {
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
    res.json({ success: true, id: entry.id });
  } catch (err) {
    console.error("[Feedback] Error saving feedback:", err);
    res.status(500).json({ error: "Failed to save feedback" });
  }
});

export default router;
