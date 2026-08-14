import { describe, it, expect, vi, beforeEach } from "vitest";

describe("sentry.ts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("stays disabled when SENTRY_DSN is not set", async () => {
    delete process.env.SENTRY_DSN;
    const sentry = await import("../observability/sentry.js");
    sentry.initSentry();
    expect(sentry.isSentryEnabled()).toBe(false);
  });

  it("enables when SENTRY_DSN is set", async () => {
    process.env.SENTRY_DSN = "https://fake@sentry.io/1";
    const sentry = await import("../observability/sentry.js");
    sentry.initSentry();
    expect(sentry.isSentryEnabled()).toBe(true);
  });

  it("captureError does not throw when disabled", async () => {
    delete process.env.SENTRY_DSN;
    const sentry = await import("../observability/sentry.js");
    expect(() => sentry.captureError(new Error("boom"))).not.toThrow();
  });
});

describe("tracer.ts — disabled path", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("initTracing disables cleanly when keys are missing", async () => {
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    const tracer = await import("../observability/tracer.js");
    const result = tracer.initTracing();
    expect(result).toEqual({ handler: null, enabled: false });
    expect(tracer.isTracingEnabled()).toBe(false);
    expect(tracer.getTraceHandler()).toBeNull();
  });

  it("traceToolCall passthrough without tracing", async () => {
    const tracer = await import("../observability/tracer.js");
    const result = await tracer.traceToolCall("executeSql", async () => 42, {});
    expect(result).toBe(42);
  });

  it("traceToolCallSync passthrough without tracing", async () => {
    const tracer = await import("../observability/tracer.js");
    expect(tracer.traceToolCallSync("exec", () => "ok")).toBe("ok");
  });
});
