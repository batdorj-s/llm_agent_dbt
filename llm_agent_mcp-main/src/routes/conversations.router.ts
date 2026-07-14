import { Router } from "express";
import { getUserId } from "./shared.js";
import {
  createConversation,
  getConversations,
  getConversationById,
  deleteConversation,
  getMessages,
  searchConversations,
  updateConversationTitle,
  togglePinConversation,
  mergeConversations,
  setConversationTags,
  addConversationTag,
  removeConversationTag,
  getAllUserTags,
} from "../services/conversation.js";

const router = Router();

router.get("/conversations", async (req, res) => {
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

router.get("/conversations/search", async (req, res) => {
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

router.get("/conversations/tags", async (req, res) => {
  try {
    const userId = getUserId(req);
    const tags = await getAllUserTags(userId);
    res.json({ success: true, data: tags });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/conversations", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { title, agentType } = req.body;
    const conversation = await createConversation(userId, title, agentType);
    res.status(201).json({ success: true, data: conversation });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/conversations/merge", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { sourceId, targetId } = req.body;
    if (!sourceId || !targetId) {
      return res.status(400).json({ error: "sourceId and targetId are required" });
    }
    const merged = await mergeConversations(sourceId, targetId, userId);
    if (!merged) return res.status(404).json({ error: "Conversations not found" });
    res.json({ success: true, message: "Conversations merged" });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Parameterized routes — must come after static paths
router.get("/conversations/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const conversation = await getConversationById(req.params.id, userId);
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    res.json({ success: true, data: conversation });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/conversations/:id/messages", async (req, res) => {
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

router.delete("/conversations/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const deleted = await deleteConversation(req.params.id, userId);
    if (!deleted) return res.status(404).json({ error: "Conversation not found" });
    res.json({ success: true, message: "Conversation deleted" });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.patch("/conversations/:id", async (req, res) => {
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

router.post("/conversations/:id/pin", async (req, res) => {
  try {
    const userId = getUserId(req);
    const isPinned = await togglePinConversation(req.params.id, userId);
    res.json({ success: true, isPinned });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.put("/conversations/:id/tags", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { tags } = req.body;
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: "tags must be an array of strings" });
    }
    const updated = await setConversationTags(req.params.id, userId, tags);
    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/conversations/:id/tags", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { tag } = req.body;
    if (!tag || typeof tag !== "string") {
      return res.status(400).json({ error: "tag is required" });
    }
    const tags = await addConversationTag(req.params.id, userId, tag);
    res.json({ success: true, data: tags });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.delete("/conversations/:id/tags/:tag", async (req, res) => {
  try {
    const userId = getUserId(req);
    const tags = await removeConversationTag(req.params.id, userId, req.params.tag);
    res.json({ success: true, data: tags });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
