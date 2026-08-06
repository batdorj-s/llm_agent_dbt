import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAdminDataProvider } from "../lib/admin/dataProvider";

const TOKEN = "test-token";

function mockFetch(ok: boolean, body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createAdminDataProvider", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getList", () => {
    it("maps resource to path and unwraps envelope", async () => {
      const fetchMock = mockFetch(true, {
        success: true,
        data: [{ id: "u1", email: "a@b.c" }],
        meta: { total: 1 },
      });
      const provider = createAdminDataProvider(() => TOKEN);

      const result = await provider.getList({ resource: "users", pagination: {} } as never);

      expect(result.data).toEqual([{ id: "u1", email: "a@b.c" }]);
      expect(result.total).toBe(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/api/admin/users");
      expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    });

    it("passes eq filters as query params", async () => {
      const fetchMock = mockFetch(true, { data: [], meta: { total: 0 } });
      const provider = createAdminDataProvider(() => TOKEN);

      await provider.getList({
        resource: "users",
        filters: [
          { field: "role", operator: "eq", value: "admin" },
          { field: "search", operator: "eq", value: "test" },
        ],
        pagination: { currentPage: 2, pageSize: 10 },
      } as never);

      const [url] = fetchMock.mock.calls[0];
      const parsed = new URL(String(url));
      expect(parsed.searchParams.get("role")).toBe("admin");
      expect(parsed.searchParams.get("search")).toBe("test");
      expect(parsed.searchParams.get("page")).toBe("2");
      expect(parsed.searchParams.get("limit")).toBe("10");
    });

    it("handles bare array responses (files endpoint)", async () => {
      mockFetch(true, [{ id: "f1" }, { id: "f2" }]);
      const provider = createAdminDataProvider(() => TOKEN);

      const result = await provider.getList({ resource: "files", pagination: {} } as never);

      expect(result.data).toEqual([{ id: "f1" }, { id: "f2" }]);
      expect(result.total).toBe(2);
    });

    it("throws on non-ok responses", async () => {
      mockFetch(false, { error: "Forbidden" }, 403);
      const provider = createAdminDataProvider(() => TOKEN);

      await expect(
        provider.getList({ resource: "users", pagination: {} } as never)
      ).rejects.toThrow("Forbidden");
    });
  });

  describe("create", () => {
    it("POSTs variables to resource path", async () => {
      const fetchMock = mockFetch(true, {
        success: true,
        data: { id: "k1", key: "sk-test" },
      });
      const provider = createAdminDataProvider(() => TOKEN);

      const result = await provider.create({
        resource: "api-keys",
        variables: { name: "dev", expiresInDays: 30 },
      } as never);

      expect(result.data).toMatchObject({ id: "k1", key: "sk-test" });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/api/admin/api-keys");
      expect((init as RequestInit).method).toBe("POST");
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({
        name: "dev",
        expiresInDays: 30,
      });
    });
  });

  describe("update", () => {
    it("PATCHes to resource/:id", async () => {
      const fetchMock = mockFetch(true, { success: true, data: { id: "u1", role: "admin" } });
      const provider = createAdminDataProvider(() => TOKEN);

      const result = await provider.update({
        resource: "users",
        id: "u1",
        variables: { role: "admin" },
      } as never);

      expect(result.data).toMatchObject({ role: "admin" });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/api/admin/users/u1");
      expect((init as RequestInit).method).toBe("PATCH");
    });
  });

  describe("deleteOne", () => {
    it("DELETEs resource/:id", async () => {
      const fetchMock = mockFetch(true, { success: true, message: "deleted" });
      const provider = createAdminDataProvider(() => TOKEN);

      const result = await provider.deleteOne({ resource: "users", id: "u9" } as never);

      expect(result.data).toBeTruthy();
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/api/admin/users/u9");
      expect((init as RequestInit).method).toBe("DELETE");
    });
  });

  describe("custom", () => {
    it("calls custom url with query params", async () => {
      const fetchMock = mockFetch(true, {
        success: true,
        data: { counts: { users: 3 } },
      });
      const provider = createAdminDataProvider(() => TOKEN);

      const result = await provider.custom!({
        url: "/api/admin/summary",
        method: "get",
        query: { since: "1d" },
      } as never);

      expect(result.data).toMatchObject({ counts: { users: 3 } });
      const [url] = fetchMock.mock.calls[0];
      expect(new URL(String(url)).searchParams.get("since")).toBe("1d");
    });
  });
});
