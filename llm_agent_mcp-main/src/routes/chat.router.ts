import { Router } from "express";
import { agentLimiter } from "../rate-limiter.js";
import { runMultiAgent, runMultiAgentStream } from "../multi-agent.js";

export const chatRouter = Router();

chatRouter.post("/", async (req, res) => {
  const userId = "user-admin-001";
  const role = "admin";

  const limit = await agentLimiter.check(userId);
  if (!limit.allowed) return res.status(429).json({ error: limit.message, resetInMs: limit.resetInMs });

  const { message, threadId, visualRequest } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

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
  const userId = "user-admin-001";
  const role = "admin";

  const limit = await agentLimiter.check(userId);
  if (!limit.allowed) return res.status(429).json({ error: limit.message });

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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown streaming error";
    res.write(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`);
  } finally {
    res.end();
  }
});
