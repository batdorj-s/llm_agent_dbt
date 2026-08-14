import { Router } from "express";
import { getUserId } from "./shared.js";
import fs from "fs";
import path from "path";

const router = Router();
const FAILED_QUERIES_PATH = path.resolve(process.cwd(), "data", "failed-queries.json");

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_RESPONSE_LENGTH = 10_000;

function capFeedbackText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

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
  const cleanMessage = capFeedbackText(message, MAX_MESSAGE_LENGTH);
  if (!cleanMessage) {
    return res.status(400).json({ error: `message must be a string between 1 and ${MAX_MESSAGE_LENGTH} characters` });
  }
  if (!["positive", "negative"].includes(rating)) {
    return res.status(400).json({ error: "rating must be 'positive' or 'negative'" });
  }
  const cleanResponse = response === undefined || response === null
    ? ""
    : capFeedbackText(response, MAX_RESPONSE_LENGTH);
  if (cleanResponse === null) {
    return res.status(400).json({ error: `response must be a string up to ${MAX_RESPONSE_LENGTH} characters` });
  }

  const entry = {
    id: `feedback_${Date.now()}`,
    userId: getUserId(req),
    message: cleanMessage,
    response: cleanResponse,
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
    console.log(`[Feedback] ${rating} feedback from ${getUserId(req)}: "${cleanMessage.slice(0, 80)}..."`);
    res.json({ success: true, id: entry.id });
  } catch (err) {
    console.error("[Feedback] Error saving feedback:", err);
    res.status(500).json({ error: "Failed to save feedback" });
  }
});

export default router;
