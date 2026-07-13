import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { agentLimiter } from "../rate-limiter.js";
import { runMultiAgent, runMultiAgentStream, type UserRole } from "../multi-agent.js";
import { DEFAULT_USER_ID, DEFAULT_ROLE } from "../auth.js";
import { addMessage, getConversationByThreadId, createConversation, updateConversationTitle } from "../services/conversation.js";

// #7: Auto-generate a short title from the first user message
function autoTitle(text: string): string {
  const cleaned = text.replace(/[^a-zA-Z0-9\u0400-\u04FF\s]/g, " ").trim();
  const words = cleaned.split(/\s+/).slice(0, 6);
  return words.length > 0 ? words.join(" ") : "Шинэ чат";
}

export const chatRouter = Router();

const ChatRequestSchema = z.object({
  message: z.string().min(1, "message required").max(10_000, "message too long (max 10000 chars)"),
  threadId: z.string().optional(),
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

/** Extract userId/role set by requireAuth middleware (api-server.ts global middleware). */
function extractAuth(req: Request): { userId: string; role: UserRole } {
  const userId = (req as any).userId as string | undefined;
  const role = (req as any).role as UserRole | undefined;
  if (userId && role) return { userId, role };
  // Fallback for when chatRouter is used without requireAuth middleware (tests, standalone)
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

    // Persist conversation messages — reuse existing conversation by threadId
    try {
      let conv = await getConversationByThreadId(threadIdFinal, userId);
      if (!conv) {
        conv = await createConversation(userId, threadIdFinal, "multi-agent");
      }
      await addMessage(conv.id, "user", message);
      await addMessage(conv.id, "assistant", response);
    } catch { /* conversation persistence is best-effort */ }

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

  // #14: Partial persistence — persist user message BEFORE streaming starts
  let conversationId: string | null = null;
  try {
    let conv = await getConversationByThreadId(threadIdFinal, userId);
    if (!conv) {
      conv = await createConversation(userId, threadIdFinal, "multi-agent");
    }
    conversationId = conv.id;
    await addMessage(conv.id, "user", message);
  } catch { /* best-effort */ }

  // #12: SSE heartbeat — send `: comment` every 15s to keep connection alive through proxies
  const heartbeatTimer = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { /* connection closed */ }
  }, 15_000);

  // #13: Agent metadata event — send agent name as first SSE event
  res.write(`data: ${JSON.stringify({ type: "agent", agent: "Шинжээч" })}\n\n`);

  try {
    await runMultiAgentStream(message, role, threadIdFinal, (chunk) => {
      fullResponse += chunk;
      res.write(`data: ${JSON.stringify({ chunk, type: "delta" })}\n\n`);
    }, visualRequest, userId);

    clearInterval(heartbeatTimer);
    res.write(`data: ${JSON.stringify({ type: "done", full: fullResponse, threadId: threadIdFinal })}\n\n`);

    // #14: Partial persistence — persist assistant response AFTER streaming completes
    // #7: Auto-naming — update title from first message
    try {
      if (conversationId) {
        await addMessage(conversationId, "assistant", fullResponse);
        // Auto-name: derive title from the first user message (only on first message)
        const title = autoTitle(message);
        await updateConversationTitle(conversationId, userId, title);
      }
    } catch { /* best-effort */ }
  } catch (err: unknown) {
    clearInterval(heartbeatTimer);
    const msg = err instanceof Error ? err.message : "Unknown streaming error";
    res.write(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`);
  } finally {
    clearInterval(heartbeatTimer);
    res.end();
  }
});
