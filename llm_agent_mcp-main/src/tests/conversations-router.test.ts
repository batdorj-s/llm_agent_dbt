import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../routes/shared.js", () => ({
  getUserId: (req: any) => req.userId,
}));

vi.mock("../services/conversation.js", () => ({
  createConversation: vi.fn(),
  getConversations: vi.fn(),
  getConversationById: vi.fn(),
  deleteConversation: vi.fn(),
  getMessages: vi.fn(),
  searchConversations: vi.fn(),
  updateConversationTitle: vi.fn(),
  togglePinConversation: vi.fn(),
  mergeConversations: vi.fn(),
  setConversationTags: vi.fn(),
  addConversationTag: vi.fn(),
  removeConversationTag: vi.fn(),
  getAllUserTags: vi.fn(),
}));

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

type Mocked = ReturnType<typeof vi.fn>;
const m = {
  createConversation: createConversation as Mocked,
  getConversations: getConversations as Mocked,
  getConversationById: getConversationById as Mocked,
  deleteConversation: deleteConversation as Mocked,
  getMessages: getMessages as Mocked,
  searchConversations: searchConversations as Mocked,
  updateConversationTitle: updateConversationTitle as Mocked,
  togglePinConversation: togglePinConversation as Mocked,
  mergeConversations: mergeConversations as Mocked,
  setConversationTags: setConversationTags as Mocked,
  addConversationTag: addConversationTag as Mocked,
  removeConversationTag: removeConversationTag as Mocked,
  getAllUserTags: getAllUserTags as Mocked,
};

function findHandler(routerModule: any, method: string, path: string) {
  const layer = routerModule.default.stack.find(
    (l: any) => l.route?.path === path && l.route.methods[method]
  );
  expect(layer).toBeDefined();
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  const res: any = { _status: 200, _json: null };
  res.status = (s: number) => {
    res._status = s;
    return res;
  };
  res.json = (j: unknown) => {
    res._json = j;
    return res;
  };
  return res;
}

const req = (body: any = {}, query: any = {}, params: any = {}) => ({
  userId: "u1",
  body,
  query,
  params,
});

describe("conversations.router", () => {
  let convRouter: any;

  beforeAll(async () => {
    convRouter = await import("../routes/conversations.router.js");
  });

  beforeEach(() => {
    for (const fn of Object.values(m)) fn.mockReset();
  });

  it("lists conversations with clamped limit", async () => {
    m.getConversations.mockResolvedValueOnce([{ id: "c1" }]);
    const res = mockRes();
    await findHandler(convRouter, "get", "/conversations")(req({}, { limit: "999" }), res);
    expect(res._status).toBe(200);
    expect(m.getConversations).toHaveBeenCalledWith("u1", 100, 0);
  });

  it("returns 400 when search query is empty", async () => {
    const res = mockRes();
    await findHandler(convRouter, "get", "/conversations/search")(req({}, { q: "  " }), res);
    expect(res._status).toBe(400);
  });

  it("searches conversations", async () => {
    m.searchConversations.mockResolvedValueOnce([{ id: "c2" }]);
    const res = mockRes();
    await findHandler(convRouter, "get", "/conversations/search")(req({}, { q: "sales" }), res);
    expect(res._status).toBe(200);
    expect(m.searchConversations).toHaveBeenCalledWith("u1", "sales", 20);
  });

  it("lists user tags", async () => {
    m.getAllUserTags.mockResolvedValueOnce(["urgent"]);
    const res = mockRes();
    await findHandler(convRouter, "get", "/conversations/tags")(req(), res);
    expect(res._status).toBe(200);
    expect(res._json.data).toEqual(["urgent"]);
  });

  it("creates a conversation with 201", async () => {
    m.createConversation.mockResolvedValueOnce({ id: "c3" });
    const res = mockRes();
    await findHandler(convRouter, "post", "/conversations")(
      req({ title: "T", agentType: "finance" }),
      res
    );
    expect(res._status).toBe(201);
  });

  it("returns 400 when merge ids are missing", async () => {
    const res = mockRes();
    await findHandler(convRouter, "post", "/conversations/merge")(req({}), res);
    expect(res._status).toBe(400);
  });

  it("merges conversations owned by the user", async () => {
    m.mergeConversations.mockResolvedValueOnce({ id: "m1" });
    const res = mockRes();
    await findHandler(convRouter, "post", "/conversations/merge")(
      req({ sourceId: "a", targetId: "b" }),
      res
    );
    expect(res._status).toBe(200);
    expect(m.mergeConversations).toHaveBeenCalledWith("a", "b", "u1");
  });

  it("returns 404 when merge target does not exist", async () => {
    m.mergeConversations.mockResolvedValueOnce(null);
    const res = mockRes();
    await findHandler(convRouter, "post", "/conversations/merge")(
      req({ sourceId: "a", targetId: "b" }),
      res
    );
    expect(res._status).toBe(404);
  });

  it("gets a conversation by id scoped to the user", async () => {
    m.getConversationById.mockResolvedValueOnce({ id: "c4" });
    const res = mockRes();
    await findHandler(convRouter, "get", "/conversations/:id")(req({}, {}, { id: "c4" }), res);
    expect(res._status).toBe(200);
    expect(m.getConversationById).toHaveBeenCalledWith("c4", "u1");
  });

  it("returns 404 when conversation not found", async () => {
    m.getConversationById.mockResolvedValueOnce(null);
    const res = mockRes();
    await findHandler(convRouter, "get", "/conversations/:id")(req({}, {}, { id: "nope" }), res);
    expect(res._status).toBe(404);
  });

  it("gets messages with clamped limit", async () => {
    m.getMessages.mockResolvedValueOnce([{ role: "user" }]);
    const res = mockRes();
    await findHandler(convRouter, "get", "/conversations/:id/messages")(
      req({}, { limit: "600" }, { id: "c4" }),
      res
    );
    expect(res._status).toBe(200);
    expect(m.getMessages).toHaveBeenCalledWith("c4", "u1", 500, 0);
  });

  it("deletes a conversation with 404 for unknown id", async () => {
    m.deleteConversation.mockResolvedValueOnce(false);
    const res = mockRes();
    await findHandler(convRouter, "delete", "/conversations/:id")(
      req({}, {}, { id: "nope" }),
      res
    );
    expect(res._status).toBe(404);
  });

  it("updates conversation title, rejecting missing titles", async () => {
    const res1 = mockRes();
    await findHandler(convRouter, "patch", "/conversations/:id")(
      req({}, {}, { id: "c5" }),
      res1
    );
    expect(res1._status).toBe(400);

    const res2 = mockRes();
    await findHandler(convRouter, "patch", "/conversations/:id")(
      req({ title: "New" }, {}, { id: "c5" }),
      res2
    );
    expect(res2._status).toBe(200);
    expect(m.updateConversationTitle).toHaveBeenCalledWith("c5", "u1", "New");
  });

  it("toggles pin and sets tags", async () => {
    m.togglePinConversation.mockResolvedValueOnce(true);
    const res1 = mockRes();
    await findHandler(convRouter, "post", "/conversations/:id/pin")(
      req({}, {}, { id: "c6" }),
      res1
    );
    expect(res1._status).toBe(200);
    expect(res1._json.isPinned).toBe(true);

    m.setConversationTags.mockResolvedValueOnce(["a"]);
    const res2 = mockRes();
    await findHandler(convRouter, "put", "/conversations/:id/tags")(
      req({ tags: ["a"] }, {}, { id: "c6" }),
      res2
    );
    expect(res2._status).toBe(200);

    const res3 = mockRes();
    await findHandler(convRouter, "put", "/conversations/:id/tags")(
      req({ tags: "not-array" }, {}, { id: "c6" }),
      res3
    );
    expect(res3._status).toBe(400);
  });

  it("adds and removes tags", async () => {
    m.addConversationTag.mockResolvedValueOnce(["a", "b"]);
    const res1 = mockRes();
    await findHandler(convRouter, "post", "/conversations/:id/tags")(
      req({ tag: "b" }, {}, { id: "c7" }),
      res1
    );
    expect(res1._status).toBe(200);

    const res2 = mockRes();
    await findHandler(convRouter, "post", "/conversations/:id/tags")(
      req({}, {}, { id: "c7" }),
      res2
    );
    expect(res2._status).toBe(400);

    m.removeConversationTag.mockResolvedValueOnce(["a"]);
    const res3 = mockRes();
    await findHandler(convRouter, "delete", "/conversations/:id/tags/:tag")(
      req({}, {}, { id: "c7", tag: "b" }),
      res3
    );
    expect(res3._status).toBe(200);
    expect(m.removeConversationTag).toHaveBeenCalledWith("c7", "u1", "b");
  });

  it("returns 500 when services throw", async () => {
    m.getConversations.mockRejectedValueOnce(new Error("db down"));
    const res = mockRes();
    await findHandler(convRouter, "get", "/conversations")(req(), res);
    expect(res._status).toBe(500);
  });
});