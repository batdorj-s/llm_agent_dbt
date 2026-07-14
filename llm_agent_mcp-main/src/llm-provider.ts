/**
 * llm-provider.ts — Free LLM Provider Auto-Selector
 *
 * Automatically picks the best available free LLM based on your .env keys.
 * Priority order: Google Gemini Flash → Groq → Anthropic → OpenAI
 *
 * Free API Keys:
 *  1 Google AI Studio (Gemini 2.0 Flash) — https://aistudio.google.com/app/apikey
 *     → 1,500 requests/day FREE, no credit card
 *
 *  2 Groq (Llama 3.3 70B)               — https://console.groq.com/keys
 *     → 14,400 requests/day FREE, blazing fast (~500 tok/s), no credit card
 *
 *  3 Mistral (Mistral Small)             — https://console.mistral.ai/api-keys/
 *     → ~1B tokens/month FREE, no credit card
 *
 * Add your chosen key(s) to .env:
 *   GOOGLE_API_KEY=...
 *   GROQ_API_KEY=...
 */

import dotenv from "dotenv";
import { withTimeout } from "./agents/agentState.js";
dotenv.config();

export type LLMProvider = "gemini" | "groq" | "anthropic" | "openai" | "none";

export const LLM_PROVIDER_TIMEOUT_MS = parseInt(process.env.LLM_PROVIDER_TIMEOUT_MS || "60000", 10);

export class AllProvidersExhaustedError extends Error {
    constructor(
        public readonly lastError: Error | null,
        public readonly attemptedProviders: LLMProvider[]
    ) {
        super(`All LLM providers failed (tried: ${attemptedProviders.join(", ")}). Last error: ${lastError?.message ?? "unknown"}`);
        this.name = "AllProvidersExhaustedError";
    }
}

export interface LLMInfo {
  provider: LLMProvider;
  model: string;
  isFree: boolean;
  rateLimit: string;
}

type ProviderConfig = { provider: LLMProvider; envKey: string; model: string; isFree: boolean; rateLimit: string };

export const DEFAULT_PROVIDER_ORDER: LLMProvider[] = ["groq", "gemini", "anthropic", "openai"];

const PROVIDERS: ProviderConfig[] = [
  {
    provider: "groq",
    envKey: "GROQ_API_KEY",
    model: "llama-3.3-70b-versatile",
    isFree: true,
    rateLimit: "14,400 req/day",
  },
  {
    provider: "gemini",
    envKey: "GOOGLE_API_KEY",
    model: "gemini-pro-latest",
    isFree: true,
    rateLimit: "1,500 req/day",
  },
  {
    provider: "anthropic",
    envKey: "ANTHROPIC_API_KEY",
    model: "claude-3-5-haiku-20241022",
    isFree: false,
    rateLimit: "paid",
  },
  {
    provider: "openai",
    envKey: "OPENAI_API_KEY",
    model: "gpt-4o-mini",
    isFree: false,
    rateLimit: "paid",
  },
];

function isKeySet(envKey: string): boolean {
  const val = process.env[envKey];
  return !!val && !val.startsWith("your_") && val !== "";
}

function getOrderedProviders(order?: LLMProvider[]): ProviderConfig[] {
  const providerOrder = order ?? DEFAULT_PROVIDER_ORDER;
  return providerOrder
    .map((provider) => PROVIDERS.find((entry) => entry.provider === provider))
    .filter((entry): entry is ProviderConfig => entry !== undefined && isKeySet(entry.envKey));
}

async function createProviderModel(
  p: ProviderConfig,
  options: { temperature: number; streaming?: boolean }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { temperature: temp, streaming } = options;

  if (p.provider === "gemini") {
    const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
    return new ChatGoogleGenerativeAI({
      model: p.model,
      apiKey: process.env.GOOGLE_API_KEY,
      temperature: temp,
      streaming,
      maxRetries: 0,
    });
  }

  if (p.provider === "groq") {
    const { ChatGroq } = await import("@langchain/groq");
    return new ChatGroq({
      model: p.model,
      apiKey: process.env.GROQ_API_KEY,
      temperature: temp,
      streaming,
      maxRetries: 0,
      timeout: LLM_PROVIDER_TIMEOUT_MS,
    });
  }

  if (p.provider === "anthropic") {
    const { ChatAnthropic } = await import("@langchain/anthropic");
    return new ChatAnthropic({
      model: p.model,
      apiKey: process.env.ANTHROPIC_API_KEY,
      temperature: temp,
      streaming,
    });
  }

  if (p.provider === "openai") {
    const { ChatOpenAI } = await import("@langchain/openai");
    return new ChatOpenAI({
      model: p.model,
      apiKey: process.env.OPENAI_API_KEY,
      temperature: temp,
      streaming,
    });
  }

  throw new Error(`Unknown provider: ${p.provider}`);
}

/**
 * Returns info about the first available LLM provider.
 */
export function detectProvider(): LLMInfo {
  for (const p of PROVIDERS) {
    if (isKeySet(p.envKey)) {
      return { provider: p.provider, model: p.model, isFree: p.isFree, rateLimit: p.rateLimit };
    }
  }
  return { provider: "none", model: "none", isFree: false, rateLimit: "N/A" };
}

/**
 * Creates and returns a LangChain chat model instance for the first available provider.
 * Returns null if no API key is configured.
 */
export async function createLLM(options?: { temperature?: number; streaming?: boolean }) {
  return await createLLMWithOrder(options);
}

export async function createLLMWithOrder(options?: {
  temperature?: number;
  streaming?: boolean;
  providerOrder?: LLMProvider[];
  fallbackOnFailure?: boolean;
}): Promise<any> {
  const temp = options?.temperature ?? 0;
  const orderedProviders = getOrderedProviders(options?.providerOrder);

  for (const p of orderedProviders) {
    try {
      console.log(`[LLM] Attempting ${p.provider.toUpperCase()} — ${p.model}...`);
      return await createProviderModel(p, { temperature: temp, streaming: options?.streaming });
    } catch (err) {
      console.warn(`[LLM] Failed to initialize ${p.provider}:`, (err as Error).message);
      continue;
    }
  }

  console.warn("[LLM] [WARN]  No LLM API key found or all providers failed.");
  return null;
}

/**
 * Check if an error is a rate-limit / quota error.
 */
export function isRateLimitError(err: unknown): boolean {
    const msg = ((err as Error)?.message ?? "").toLowerCase();
    return msg.includes("429") || msg.includes("rate limit") || msg.includes("quota") ||
        msg.includes("too many requests") || msg.includes("rate_limit") ||
        msg.includes("resource exhausted") || msg.includes("daily");
}

/**
 * Try calling model.invoke() with automatic fallback across available providers.
 * If the primary provider returns a rate-limit error, it cycles to the next configured provider.
 */
export async function invokeWithFallback(
    messages: { role: string; content: string }[],
    options?: {
        temperature?: number;
        streaming?: boolean;
        providerOrder?: LLMProvider[];
        timeout?: number;
    }
): Promise<{ content: string; provider: LLMProvider }> {
    const temp = options?.temperature ?? 0;
    const orderedProviders = getOrderedProviders(options?.providerOrder);

    if (orderedProviders.length === 0) {
        throw new AllProvidersExhaustedError(null, []);
    }

    let lastError: Error | null = null;
    const attempted: LLMProvider[] = [];
    for (const p of orderedProviders) {
        let lastProviderError: Error | null = null;
        // Retry once on rate-limit with exponential backoff (5s, then 15s)
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                console.log(`[LLM] Invoking ${p.provider.toUpperCase()} — ${p.model} (attempt ${attempt + 1})...`);
                const model = await createProviderModel(p, { temperature: temp, streaming: options?.streaming });

                const response = options?.timeout
                    ? await withTimeout(model.invoke(messages), `${p.provider} invoke`, options.timeout)
                    : await model.invoke(messages);

                return { content: response.content as string, provider: p.provider };
            } catch (err: unknown) {
                lastProviderError = err instanceof Error ? err : new Error(String(err));
                const isRateLimit = isRateLimitError(err);
                console.warn(`[LLM] ${p.provider.toUpperCase()} failed: ${isRateLimit ? "RATE LIMIT" : lastProviderError.message}`);
                if (isRateLimit && attempt === 0) {
                    const delayMs = 5000 * (attempt + 1);
                    console.log(`[LLM] Rate limited on ${p.provider}, retrying in ${delayMs / 1000}s...`);
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                } else {
                    break;
                }
            }
        }
        lastError = lastProviderError;
        attempted.push(p.provider);
        console.log(`[LLM] Falling back to next provider after ${p.provider} failure...`);
    }

    console.error(`[LLM] All providers exhausted (tried: ${attempted.join(", ")}). Last error: ${lastError?.message}`);
    throw new AllProvidersExhaustedError(lastError, attempted);
}

/**
 * Like invokeWithFallback but returns a stream. Used for streaming responses.
 */
export async function streamWithFallback(
    messages: { role: string; content: string }[],
    options?: {
        temperature?: number;
        providerOrder?: LLMProvider[];
        timeout?: number;
    }
): Promise<{ stream: any; provider: LLMProvider }> {
    const temp = options?.temperature ?? 0;
    const orderedProviders = getOrderedProviders(options?.providerOrder);

    if (orderedProviders.length === 0) {
        throw new AllProvidersExhaustedError(null, []);
    }

    let lastError: Error | null = null;
    const attempted: LLMProvider[] = [];
    for (const p of orderedProviders) {
        let lastProviderError: Error | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                console.log(`[LLM] Streaming ${p.provider.toUpperCase()} — ${p.model} (attempt ${attempt + 1})...`);
                const model = await createProviderModel(p, { temperature: temp, streaming: true });

                const stream = options?.timeout
                    ? await withTimeout(model.stream(messages), `${p.provider} stream`, options.timeout)
                    : await model.stream(messages);

                return { stream, provider: p.provider };
            } catch (err: unknown) {
                lastProviderError = err instanceof Error ? err : new Error(String(err));
                const isRateLimit = isRateLimitError(err);
                console.warn(`[LLM] ${p.provider.toUpperCase()} stream failed: ${isRateLimit ? "RATE LIMIT" : lastProviderError.message}`);
                if (isRateLimit && attempt === 0) {
                    const delayMs = 5000 * (attempt + 1);
                    console.log(`[LLM] Rate limited on ${p.provider}, retrying in ${delayMs / 1000}s...`);
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                } else {
                    break;
                }
            }
        }
        lastError = lastProviderError;
        attempted.push(p.provider);
        console.log(`[LLM] Falling back to next provider after ${p.provider} failure...`);
    }

    throw new AllProvidersExhaustedError(lastError, attempted);
}

/**
 * Print available provider status to the console (useful for debugging).
 */
export function printProviderStatus(): void {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║           LLM Provider Status                        ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  for (const p of PROVIDERS) {
    const active = isKeySet(p.envKey);
    const badge  = p.isFree ? "[FREE]" : "[PAID]";
    const status = active ? "[OK] ACTIVE" : "[NOT_SET] not set";
    console.log(`║ ${badge} ${p.provider.padEnd(10)} ${p.model.padEnd(28)} ${status} ║`);
  }
  console.log("╚══════════════════════════════════════════════════════╝\n");
}
