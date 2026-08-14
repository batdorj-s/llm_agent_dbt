import { Router } from "express";
import { getUserId } from "./shared.js";
import { createFeedback } from "../db/feedback-repository.js";

const router = Router();

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_RESPONSE_LENGTH = 10_000;

function capFeedbackText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
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

  const userId = getUserId(req);

  try {
    const entry = await createFeedback({
      id: `feedback_${Date.now()}`,
      userId,
      message: cleanMessage,
      response: cleanResponse,
      rating,
      threadId: threadId || null,
    });
    console.log(`[Feedback] ${rating} feedback from ${userId}: "${cleanMessage.slice(0, 80)}..."`);
    res.json({ success: true, id: entry.id });
  } catch (err) {
    console.error("[Feedback] Error saving feedback:", err);
    res.status(500).json({ error: "Failed to save feedback" });
  }
});

export default router;
