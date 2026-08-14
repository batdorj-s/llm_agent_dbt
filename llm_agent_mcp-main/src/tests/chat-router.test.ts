import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../rate-limiter.js", () => ({
  agentLimiter: { check: vi.fn() },
}));

vi.mock("../multi-agent.js", () => ({
  runMultiAgent: vi.fn(),
  runMultiAgentStream: vi.fn(),
}));

vi.mock("../auth.js", () => ({
  DEFAULT_USER_ID: "dev-user",
  DEFAULT_ROLE: "analyst",
}));

vi.mock("../services/conversation.js", () => ({
  addMessage: vi.fn(),
  getConversationByThreadId: vi.fn(),
  createConversation: vi.fn(),
  updateConversationTitle: vi.fn(),
}));

import { agentLimiter } from "../rate-limiter.js";
import { runMultiAgent, runMultiAgentStream } from "../multi-agent.js";
import {
  addMessage,
  getConversationByThreadId,
  createConversation,
  updateConversationTitle,
} from "../services/conversation.js";

const mockedLimiter = agentLimiter as unknown as { check: ReturnType<typeof vi.fn> };
const mockedRun = runMultiAgent as ReturnType<typeof vi.fn>;
const mockedStream = runMultiAgentStream as ReturnType<typeof vi.fn>;
const mockedGetConv = getConversationByThreadId as ReturnType<typeof vi.fn>;
const mockedCreateConv = createConversation as ReturnType<typeof vi.fn>;
const mockedUpdateTitle = updateConversationTitle as ReturnType<typeof vi.fn>;
const mockedAddMessage = addMessage as ReturnType<typeof vi.fn>;

function findHandler(routerModule: any, method: string, path: string) {
  const layer = routerModule.chatRouter.stack.find(
    (l: any) => l.route?.path === path && l.route.methods[method]
  );
  expect(layer).toBeDefined();
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  const res: any = { _status: 200, _json: null, _headers: {}, _writes: [] };
  res.status = (s: number) => {
    res._status = s;
    return res;
  };
  res.json = (j: unknown) => {
    res._json = j;
    return res;
  };
  res.setHeader = (k: string, v: string) => {
    res._headers[k] = v;
    return res;
  };
  res.write = (s: string) => {
    res._writes.push(s);
    return res;
  };
  res.end = vi.fn();
  return res;
}

describe("chat.router", () => {
  let chatRouter: any;
  let postHandler: any;
  let streamHandler: any;

  beforeAll(async () => {
    chatRouter = await import("../routes/chat.router.js");
    postHandler = findHandler(chatRouter, "post", "/");
    streamHandler = findHandler(chatRouter, "post", "/stream");
  });

  beforeEach(() => {
    mockedLimiter.check.mockReset();
    mockedLimiter.check.mockResolvedValue({ allowed: true, remaining: 9, message: "" });
    mockedRun.mockReset();
    mockedStream.mockReset();
    mockedGetConv.mockReset();
    mockedCreateConv.mockReset();
    mockedUpdateTitle.mockReset();
    mockedAddMessage.mockReset();
  });

  describe("POST /", () => {
    it("returns 400 for an empty message", async () => {
      const res = mockRes();
      await postHandler({ body: { message: "" } }, res);
      expect(res._status).toBe(400);
      expect(res._json.error).toBe("Validation failed");
    });

    it("returns 400 for a message over 10000 chars", async () => {
      const res = mockRes();
      await postHandler({ body: { message: "x".repeat(10001) } }, res);
      expect(res._status).toBe(400);
      expect(res._json.details[0].message).toMatch(/too long/i);
    });

    it("returns 429 when rate limited", async () => {
      mockedLimiter.check.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        message: "Rate limit exceeded",
        resetInMs: 60000,
      });
      const res = mockRes();
      await postHandler({ userId: "u1", role: "analyst", body: { message: "hi" } }, res);
      expect(res._status).toBe(429);
      expect(res._json.resetInMs).toBe(60000);
    });

    it("runs the agent and persists conversation messages", async () => {
      mockedRun.mockResolvedValueOnce("analysis result");
      mockedGetConv.mockResolvedValueOnce({ id: "conv-1", title: "my thread", threadId: "t1" });
      const res = mockRes();
      await postHandler(
        { userId: "u1", role: "analyst", body: { message: "hello", threadId: "t1" } },
        res
      );
      expect(res._status).toBe(200);
      expect(res._json.response).toBe("analysis result");
      expect(res._json.threadId).toBe("t1");
      expect(mockedRun).toHaveBeenCalledWith("hello", "analyst", "t1", undefined, "u1");
      expect(mockedGetConv).toHaveBeenCalledWith("t1", "u1");
      expect(mockedAddMessage).toHaveBeenCalledTimes(2);
    });

    it("creates a conversation and auto-titles the first message", async () => {
      mockedRun.mockResolvedValueOnce("ok");
      mockedGetConv.mockResolvedValueOnce(null);
      mockedCreateConv.mockResolvedValueOnce({ id: "conv-2", title: "t2", threadId: "t2" });
      mockedUpdateTitle.mockResolvedValueOnce(undefined);
      const res = mockRes();
      await postHandler(
        { userId: "u1", role: "viewer", body: { message: "Борлуулалтын тайлан" } },
        res
      );
      expect(res._status).toBe(200);
      expect(mockedCreateConv).toHaveBeenCalledWith("u1", undefined, "multi-agent", expect.stringMatching(/^thread_/));
      expect(mockedUpdateTitle).toHaveBeenCalledWith("conv-2", "u1", expect.stringContaining("Борлуулалтын"));
    });

    it("returns 500 when the agent throws", async () => {
      mockedRun.mockRejectedValueOnce(new Error("agent failure"));
      const res = mockRes();
      await postHandler({ userId: "u1", role: "analyst", body: { message: "hi" } }, res);
      expect(res._status).toBe(500);
      expect(res._json.error).toBe("agent failure");
    });
  });

  describe("POST /stream", () => {
    it("returns 400 for invalid body", async () => {
      const res = mockRes();
      await streamHandler({ body: {} }, res);
      expect(res._status).toBe(400);
    });

    it("returns 429 when rate limited", async () => {
      mockedLimiter.check.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        message: "Rate limit exceeded",
        resetInMs: 5000,
      });
      const res = mockRes();
      await streamHandler({ userId: "u1", role: "analyst", body: { message: "hi" } }, res);
      expect(res._status).toBe(429);
    });

    it("streams deltas, persists the user message, and ends with done", async () => {
      mockedGetConv.mockResolvedValueOnce({ id: "conv-3", title: "t3", threadId: "t3" });
      mockedStream.mockImplementation(async (_msg: string, _role: string, _tid: string, onChunk: (c: string) => void) => {
        onChunk("chunk1");
        onChunk("chunk2");
      });
      const res = mockRes();
      await streamHandler({ userId: "u1", role: "analyst", body: { message: "hi" } }, res);
      expect(res._headers["Content-Type"]).toBe("text/event-stream");
      expect(mockedAddMessage).toHaveBeenCalledWith("conv-3", "user", "hi");
      expect(res._writes.some((w: string) => w.includes('"type":"agent"'))).toBe(true);
      expect(res._writes.some((w: string) => w.includes("chunk1"))).toBe(true);
      expect(res._writes.some((w: string) => w.includes('"type":"done"' ))).toBe(true);
      expect(res.end).toHaveBeenCalled();
    });

    it("emits an error event when streaming fails", async () => {
      mockedGetConv.mockResolvedValueOnce(null);
      mockedCreateConv.mockResolvedValueOnce({ id: "conv-4", title: "t4", threadId: "t4" });
      mockedStream.mockRejectedValueOnce(new Error("stream exploded"));
      const res = mockRes();
      await streamHandler({ userId: "u1", role: "analyst", body: { message: "hi" } }, res);
      expect(res._writes.some((w: string) => w.includes('"type":"error"'))).toBe(true);
      expect(res._writes.some((w: string) => w.includes("stream exploded"))).toBe(true);
      expect(res.end).toHaveBeenCalled();
    });
  });
});