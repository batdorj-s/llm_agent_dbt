import { describe, it, expect, vi, beforeAll } from "vitest";

describe("Python Execution Agent", () => {
  let executeTechPythonAgent: any;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock("../llm-provider.js", () => ({
      invokeWithFallback: vi.fn().mockResolvedValue({
        content: "```python\nprint('hello world')\n```",
      }),
    }));
    vi.doMock("../sandbox.js", () => ({
      runPythonCode: vi.fn().mockResolvedValue("hello world"),
    }));
    vi.doMock("../utils.js", () => ({
      extractCodeBlock: vi.fn().mockReturnValue("print('hello world')"),
    }));

    const mod = await import("../agents/pythonExecution.js");
    executeTechPythonAgent = mod.executeTechPythonAgent;
  });

  it("runs python code and returns output with explanation", async () => {
    const result = await executeTechPythonAgent({}, "analyze this", undefined, "user-1");
    expect(result.messages).toBeDefined();
    expect(result.messages[0].content).toContain("Python");
    expect(result.messages[0].content).toContain("hello world");
  });

  it("handles LLM failure gracefully", async () => {
    vi.resetModules();
    vi.doMock("../llm-provider.js", () => ({
      invokeWithFallback: vi.fn().mockRejectedValue(new Error("LLM failed")),
    }));
    vi.doMock("../sandbox.js", () => ({ runPythonCode: vi.fn() }));
    vi.doMock("../utils.js", () => ({ extractCodeBlock: vi.fn() }));

    const mod = await import("../agents/pythonExecution.js");
    const result = await mod.executeTechPythonAgent({}, "analyze", undefined, "user-1");
    expect(result.messages[0].content).toContain("алдаа");
  });
});
