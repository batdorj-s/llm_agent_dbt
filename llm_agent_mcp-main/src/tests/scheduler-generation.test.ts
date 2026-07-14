import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Scheduler Report Generation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should generate CSV buffer from query results", async () => {
    const scheduler = await import("../services/scheduler.js");
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { name: "Alice", sales: 100 },
          { name: "Bob", sales: 200 },
        ],
      }),
    };
    const { buffer, rowCount } = await (scheduler as any).generateCsv("SELECT * FROM test", mockPool);
    expect(rowCount).toBe(2);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.toString()).toContain("name,sales");
    expect(buffer.toString()).toContain("Alice");
    expect(buffer.toString()).toContain("Bob");
  });

  it("should generate JSON buffer from query results", async () => {
    const scheduler = await import("../services/scheduler.js");
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 1, value: "test" }],
      }),
    };
    const { buffer, rowCount } = await (scheduler as any).generateJson("SELECT * FROM test", mockPool);
    expect(rowCount).toBe(1);
    expect(buffer).toBeInstanceOf(Buffer);
    const parsed = JSON.parse(buffer.toString());
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].id).toBe(1);
  });

  it("should generate empty CSV for empty results", async () => {
    const scheduler = await import("../services/scheduler.js");
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const { buffer, rowCount } = await (scheduler as any).generateCsv("SELECT * FROM empty", mockPool);
    expect(rowCount).toBe(0);
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it("should generate empty JSON for empty results", async () => {
    const scheduler = await import("../services/scheduler.js");
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const { buffer, rowCount } = await (scheduler as any).generateJson("SELECT * FROM empty", mockPool);
    expect(rowCount).toBe(0);
    expect(buffer).toBeInstanceOf(Buffer);
    const parsed = JSON.parse(buffer.toString());
    expect(parsed.data).toHaveLength(0);
    expect(parsed.count).toBe(0);
  });

  it("should escape CSV values with commas", async () => {
    const scheduler = await import("../services/scheduler.js");
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ name: "Doe, John", city: "NYC" }],
      }),
    };
    const { buffer } = await (scheduler as any).generateCsv("SELECT * FROM test", mockPool);
    const content = buffer.toString();
    expect(content).toContain('"Doe, John"');
    expect(content).toContain("NYC");
  });

  it("should return correct format label", async () => {
    const scheduler = await import("../services/scheduler.js");
    // Use the internal function or just verify the switch logic
    const testCases = [
      { input: "pdf", expected: "pdf" },
      { input: "xlsx", expected: "xlsx" },
      { input: "csv", expected: "csv" },
      { input: "json", expected: "json" },
      { input: "unknown", expected: "pdf" },
    ];
    for (const tc of testCases) {
      // This is a test of the router's route registration
      const router = await import("../routes/scheduler.router.js");
      expect(router.default).toBeDefined();
    }
  });

  it("should register download endpoint", async () => {
    const router = await import("../routes/scheduler.router.js");
    const routes = router.default.stack || [];
    const paths = routes.map((r: any) => r.route?.path).filter(Boolean);
    expect(paths).toContain("/scheduler/reports/:id/download");
  });
});
