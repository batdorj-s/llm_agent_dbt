import { describe, it, expect, vi } from "vitest";

describe("Catalog Enhanced Access", () => {
  it("should export canAccessCatalogEntry from catalog.ts", async () => {
    const catalog = await import("../db/catalog.js");
    expect(catalog.canAccessCatalogEntry).toBeDefined();
    expect(typeof catalog.canAccessCatalogEntry).toBe("function");
  });

  it("should export canAccessCatalogEntryEnhanced", async () => {
    const catalog = await import("../db/catalog.js");
    expect(catalog.canAccessCatalogEntryEnhanced).toBeDefined();
    expect(typeof catalog.canAccessCatalogEntryEnhanced).toBe("function");
  });

  it("canAccessCatalogEntry: shared visibility grants access", async () => {
    const { canAccessCatalogEntry } = await import("../db/catalog.js");
    expect(canAccessCatalogEntry({ owner_id: "user-1", visibility: "shared" }, "user-2")).toBe(true);
  });

  it("canAccessCatalogEntry: owner always has access", async () => {
    const { canAccessCatalogEntry } = await import("../db/catalog.js");
    expect(canAccessCatalogEntry({ owner_id: "user-1", visibility: "private" }, "user-1")).toBe(true);
  });

  it("canAccessCatalogEntry: private non-owner blocked", async () => {
    const { canAccessCatalogEntry } = await import("../db/catalog.js");
    expect(canAccessCatalogEntry({ owner_id: "user-1", visibility: "private" }, "user-2")).toBe(false);
  });

  it("canAccessCatalogEntryEnhanced: shared visibility grants access", async () => {
    const { canAccessCatalogEntryEnhanced } = await import("../db/catalog.js");
    const result = await canAccessCatalogEntryEnhanced(
      { owner_id: "user-1", visibility: "shared", table_name: "test" },
      "user-2"
    );
    expect(result).toBe(true);
  });

  it("canAccessCatalogEntryEnhanced: owner always has access", async () => {
    const { canAccessCatalogEntryEnhanced } = await import("../db/catalog.js");
    const result = await canAccessCatalogEntryEnhanced(
      { owner_id: "user-1", visibility: "private", table_name: "test" },
      "user-1"
    );
    expect(result).toBe(true);
  });

  it("canAccessCatalogEntryEnhanced: private non-owner falls through to DB check", async () => {
    vi.doMock("../db/pool.js", () => ({
      getPool: vi.fn(() => ({
        query: vi.fn().mockResolvedValue({ rows: [] }),
      })),
    }));

    const { canAccessCatalogEntryEnhanced } = await import("../db/catalog.js");
    const result = await canAccessCatalogEntryEnhanced(
      { owner_id: "user-1", visibility: "private", table_name: "secret_table" },
      "user-2"
    );
    expect(result).toBe(false);

    vi.unmock("../db/pool.js");
  });
});
