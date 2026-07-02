import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectProvider, isRateLimitError, DEFAULT_PROVIDER_ORDER } from "../llm-provider.js";

// ── Mock LangChain packages ──────────────────────────────────
// hoisted runs before vi.mock factories, so mock functions are available
// when the mock module factory closes over them.
// We use mock classes (not vi.fn()) because LangChain calls `new ChatGroq(...)`
// which requires a proper constructor.
const { mockGroqInvoke, mockGeminiInvoke, mockAnthropicInvoke, mockOpenaiInvoke } = vi.hoisted(() => {
    const mockGroqInvoke = vi.fn();
    const mockGeminiInvoke = vi.fn();
    const mockAnthropicInvoke = vi.fn();
    const mockOpenaiInvoke = vi.fn();
    return { mockGroqInvoke, mockGeminiInvoke, mockAnthropicInvoke, mockOpenaiInvoke };
});

vi.mock("@langchain/groq", () => ({
    ChatGroq: class {
        constructor() { /* noop */ }
        invoke = mockGroqInvoke;
    },
}));
vi.mock("@langchain/google-genai", () => ({
    ChatGoogleGenerativeAI: class {
        constructor() { /* noop */ }
        invoke = mockGeminiInvoke;
    },
}));
vi.mock("@langchain/anthropic", () => ({
    ChatAnthropic: class {
        constructor() { /* noop */ }
        invoke = mockAnthropicInvoke;
    },
}));
vi.mock("@langchain/openai", () => ({
    ChatOpenAI: class {
        constructor() { /* noop */ }
        invoke = mockOpenaiInvoke;
    },
}));

// ── Tests ────────────────────────────────────────────────────

describe("isRateLimitError", () => {
    it("detects 429 status code", () => {
        expect(isRateLimitError(new Error("429 Too Many Requests"))).toBe(true);
    });

    it("detects 'rate limit' message", () => {
        expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
    });

    it("detects 'quota' message", () => {
        expect(isRateLimitError(new Error("quota exceeded"))).toBe(true);
    });

    it("detects 'too many requests' message", () => {
        expect(isRateLimitError(new Error("too many requests"))).toBe(true);
    });

    it("detects 'resource exhausted' message", () => {
        expect(isRateLimitError(new Error("resource exhausted"))).toBe(true);
    });

    it("detects 'daily' limit message", () => {
        expect(isRateLimitError(new Error("daily limit reached"))).toBe(true);
    });

    it("returns false for non-rate-limit errors", () => {
        expect(isRateLimitError(new Error("network error"))).toBe(false);
        expect(isRateLimitError(new Error("timeout"))).toBe(false);
        expect(isRateLimitError(new Error("401 unauthorized"))).toBe(false);
        expect(isRateLimitError(null)).toBe(false);
        expect(isRateLimitError({})).toBe(false);
    });
});

describe("detectProvider", () => {
    const OLD = { ...process.env };

    afterEach(() => {
        process.env.GROQ_API_KEY = OLD.GROQ_API_KEY;
        process.env.GOOGLE_API_KEY = OLD.GOOGLE_API_KEY;
        process.env.ANTHROPIC_API_KEY = OLD.ANTHROPIC_API_KEY;
        process.env.OPENAI_API_KEY = OLD.OPENAI_API_KEY;
        delete process.env.GROQ_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENAI_API_KEY;
    });

    it("detects groq when GROQ_API_KEY is set", () => {
        process.env.GROQ_API_KEY = "real-key";
        const info = detectProvider();
        expect(info.provider).toBe("groq");
        expect(info.model).toBe("llama-3.3-70b-versatile");
        expect(info.isFree).toBe(true);
    });

    it("detects gemini when only GOOGLE_API_KEY is set", () => {
        process.env.GOOGLE_API_KEY = "real-key";
        const info = detectProvider();
        expect(info.provider).toBe("gemini");
        expect(info.model).toBe("gemini-pro-latest");
    });

    it("returns provider order based on PROVIDERS array", () => {
        process.env.GROQ_API_KEY = "gk";
        process.env.GOOGLE_API_KEY = "gg";
        const info = detectProvider();
        expect(info.provider).toBe("groq"); // groq is first in PROVIDERS
    });

    it("returns 'none' when no API keys are set", () => {
        const info = detectProvider();
        expect(info.provider).toBe("none");
        expect(info.model).toBe("none");
        expect(info.isFree).toBe(false);
    });

    it("ignores placeholder keys starting with 'your_'", () => {
        process.env.GROQ_API_KEY = "your_groq_key_here";
        const info = detectProvider();
        expect(info.provider).toBe("none");
    });

    it("ignores empty string keys", () => {
        process.env.GROQ_API_KEY = "";
        const info = detectProvider();
        expect(info.provider).toBe("none");
    });
});

describe("invokeWithFallback", () => {
    let invokeWithFallback: typeof import("../llm-provider.js")["invokeWithFallback"];

    beforeEach(async () => {
        // Set env so all providers are "available"
        process.env.GROQ_API_KEY = "gk-test";
        process.env.GOOGLE_API_KEY = "gg-test";
        process.env.ANTHROPIC_API_KEY = "ac-test";
        process.env.OPENAI_API_KEY = "oa-test";

        // Reset mock invoke behavior
        mockGroqInvoke.mockReset();
        mockGeminiInvoke.mockReset();
        mockAnthropicInvoke.mockReset();
        mockOpenaiInvoke.mockReset();

        // Re-import to pick up env changes
        const mod = await import("../llm-provider.js");
        invokeWithFallback = mod.invokeWithFallback;
    });

    afterEach(() => {
        delete process.env.GROQ_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENAI_API_KEY;
    });

    const msg = [{ role: "user" as const, content: "hello" }];

    it("1. returns content from the first (groq) provider on success", async () => {
        mockGroqInvoke.mockResolvedValue({ content: "groq ok" });

        const result = await invokeWithFallback(msg);

        expect(result).toEqual({ content: "groq ok", provider: "groq" });
        expect(mockGroqInvoke).toHaveBeenCalledTimes(1);
        expect(mockGeminiInvoke).not.toHaveBeenCalled();
    });

    it("2. falls back to next provider on rate limit", async () => {
        mockGroqInvoke.mockRejectedValue(new Error("429 rate limit"));
        mockGeminiInvoke.mockResolvedValue({ content: "gemini ok" });

        const result = await invokeWithFallback(msg);

        expect(result).toEqual({ content: "gemini ok", provider: "gemini" });
        expect(mockGroqInvoke).toHaveBeenCalledTimes(1);
        expect(mockGeminiInvoke).toHaveBeenCalledTimes(1);
    });

    it("3. returns null when all providers hit rate limit", async () => {
        mockGroqInvoke.mockRejectedValue(new Error("rate limit"));
        mockGeminiInvoke.mockRejectedValue(new Error("rate limit"));
        mockAnthropicInvoke.mockRejectedValue(new Error("rate limit"));
        mockOpenaiInvoke.mockRejectedValue(new Error("rate limit"));

        const result = await invokeWithFallback(msg);

        expect(result).toBeNull();
        expect(mockGroqInvoke).toHaveBeenCalledTimes(1);
        expect(mockGeminiInvoke).toHaveBeenCalledTimes(1);
        expect(mockAnthropicInvoke).toHaveBeenCalledTimes(1);
        expect(mockOpenaiInvoke).toHaveBeenCalledTimes(1);
    });

    it("4. falls back to next provider on timeout", async () => {
        mockGroqInvoke.mockRejectedValue(new Error("timeout exceeded"));
        mockGeminiInvoke.mockResolvedValue({ content: "gemini ok" });

        const result = await invokeWithFallback(msg);

        expect(result).toEqual({ content: "gemini ok", provider: "gemini" });
    });

    it("5. skips providers without API keys", async () => {
        delete process.env.GROQ_API_KEY;
        mockGeminiInvoke.mockResolvedValue({ content: "gemini ok" });

        // Re-import so isKeySet() re-reads env
        const mod = await import("../llm-provider.js");
        const result = await mod.invokeWithFallback(msg);

        expect(result).toEqual({ content: "gemini ok", provider: "gemini" });
        expect(mockGroqInvoke).not.toHaveBeenCalled();
        expect(mockGeminiInvoke).toHaveBeenCalledTimes(1);
    });

    it("6. falls back to next provider on network error", async () => {
        mockGroqInvoke.mockRejectedValue(new Error("fetch failed: connect ECONNREFUSED"));
        mockGeminiInvoke.mockResolvedValue({ content: "gemini ok" });

        const result = await invokeWithFallback(msg);

        expect(result).toEqual({ content: "gemini ok", provider: "gemini" });
    });

    it("7. returns null with explicit message when all providers fail", async () => {
        mockGroqInvoke.mockRejectedValue(new Error("network error"));
        mockGeminiInvoke.mockRejectedValue(new Error("network error"));
        mockAnthropicInvoke.mockRejectedValue(new Error("network error"));
        mockOpenaiInvoke.mockRejectedValue(new Error("network error"));

        const result = await invokeWithFallback(msg);

        expect(result).toBeNull();
    });

    it("8. respects providerOrder option", async () => {
        mockAnthropicInvoke.mockResolvedValue({ content: "anthropic ok" });

        const result = await invokeWithFallback(msg, {
            providerOrder: ["anthropic", "groq"],
        });

        expect(result).toEqual({ content: "anthropic ok", provider: "anthropic" });
        expect(mockAnthropicInvoke).toHaveBeenCalledTimes(1);
        expect(mockGroqInvoke).not.toHaveBeenCalled();
    });

    it("9. returns null when no API keys configured", async () => {
        delete process.env.GROQ_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENAI_API_KEY;

        const mod = await import("../llm-provider.js");
        const result = await mod.invokeWithFallback(msg);

        expect(result).toBeNull();
        expect(mockGroqInvoke).not.toHaveBeenCalled();
    });

    it("10. falls back on auth error (401)", async () => {
        mockGroqInvoke.mockRejectedValue(new Error("401 Unauthorized"));
        mockGeminiInvoke.mockResolvedValue({ content: "gemini ok" });

        const result = await invokeWithFallback(msg);

        expect(result).toEqual({ content: "gemini ok", provider: "gemini" });
    });

    it("respects timeout option — timeout triggers fallback", async () => {
        mockGroqInvoke.mockRejectedValue(new Error("timeout"));
        mockGeminiInvoke.mockResolvedValue({ content: "gemini ok" });

        const result = await invokeWithFallback(msg, { timeout: 5000 });

        expect(result).toEqual({ content: "gemini ok", provider: "gemini" });
    });
});
