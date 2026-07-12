import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { agentLimiter } from "../rate-limiter.js";
import { runMultiAgent, runMultiAgentStream, type UserRole } from "../multi-agent.js";
import { verifyToken, DEFAULT_USER_ID, DEFAULT_ROLE } from "../auth.js";

export const chatRouter = Router();

const ChatRequestSchema = z.object({
  message: z.string().min(1, "message required").max(10_000, "message too long (max 10000 chars)"),
  threadId: z.string().uuid("threadId must be a valid UUID").optional(),
  visualRequest: z.boolean().optional(),
});

/**
 * @openapi
 * /api/chat:
 *   post:
 *     tags: [Chat]
 *     summary: Send a message to the AI analyst
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *                 maxLength: 10000
 *                 description: User message in Mongolian or English
 *               threadId:
 *                 type: string
 *                 format: uuid
 *                 description: Conversation thread ID
 *               visualRequest:
 *                 type: boolean
 *                 description: Request visual/chart output
 *     responses:
 *       200:
 *         description: Agent response with analysis
 *       400:
 *         description: Validation error
 *       429:
 *         description: Rate limit exceeded
 */

function extractAuth(req: Request): { userId: string; role: UserRole } {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { userId: DEFAULT_USER_ID, role: DEFAULT_ROLE };
  }
  const token = authHeader.slice(7);
  const result = verifyToken(token);
  if (result.success && result.payload) {
    return { userId: result.payload.userId, role: result.payload.role };
  }
  return { userId: DEFAULT_USER_ID, role: DEFAULT_ROLE };
}

chatRouter.post("/", async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })),
    });
  }

  const { userId, role } = extractAuth(req);

  const limit = await agentLimiter.check(userId);
  if (!limit.allowed) return res.status(429).json({ error: limit.message, resetInMs: limit.resetInMs });

  // Set rate limit headers
  res.setHeader("X-RateLimit-Limit", "10");
  res.setHeader("X-RateLimit-Remaining", String(limit.remaining));

  const { message, threadId, visualRequest } = parsed.data;

  try {
    const threadIdFinal = threadId ?? `thread_${Date.now()}`;
    const response = await runMultiAgent(message, role, threadIdFinal, visualRequest, userId);
    res.json({ response, threadId: threadIdFinal, role, remaining: limit.remaining });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

chatRouter.post("/stream", async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })),
    });
  }

  const { userId, role } = extractAuth(req);

  const limit = await agentLimiter.check(userId);
  if (!limit.allowed) return res.status(429).json({ error: limit.message });

  const { message, threadId, visualRequest } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const threadIdFinal = threadId ?? `thread_${Date.now()}`;
  let fullResponse = "";

  try {
    await runMultiAgentStream(message, role, threadIdFinal, (chunk) => {
      fullResponse += chunk;
      res.write(`data: ${JSON.stringify({ chunk, type: "delta" })}\n\n`);
    }, visualRequest, userId);
    res.write(`data: ${JSON.stringify({ type: "done", full: fullResponse, threadId: threadIdFinal })}\n\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown streaming error";
    res.write(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`);
  } finally {
    res.end();
  }
});
