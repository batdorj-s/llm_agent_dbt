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
  const llm = await createLLMWithOrder(options);
  if (!llm) return null;

  // Wrap the LLM in a proxy to handle automatic fallback on execution failure
  return llm;
}

export async function createLLMWithOrder(options?: { 
  temperature?: number; 
  streaming?: boolean; 
  providerOrder?: LLMProvider[];
  fallbackOnFailure?: boolean;
}) {
  const temp = options?.temperature ?? 0;
  const providerOrder = options?.providerOrder ?? DEFAULT_PROVIDER_ORDER;
  const orderedProviders = providerOrder
    .map((provider) => PROVIDERS.find((entry) => entry.provider === provider))
    .filter((entry): entry is ProviderConfig => Boolean(entry));

  for (const p of orderedProviders) {
    if (!isKeySet(p.envKey)) continue;

    try {
      console.log(`[LLM] Attempting ${p.provider.toUpperCase()} — ${p.model}...`);

      if (p.provider === "gemini") {
        const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
        const model = new ChatGoogleGenerativeAI({
          model: p.model,
          apiKey: process.env.GOOGLE_API_KEY,
          temperature: temp,
          streaming: options?.streaming,
          maxRetries: 0, // We handle retries/fallback manually
        });
        
        // Quick health check (optional but recommended)
        // For now, we return the model and let the consumer handle errors or use a wrapper
        return model;
      }

      if (p.provider === "groq") {
        const { ChatGroq } = await import("@langchain/groq");
        return new ChatGroq({
          model: p.model,
          apiKey: process.env.GROQ_API_KEY,
          temperature: temp,
          streaming: options?.streaming,
          maxRetries: 0,
          timeout: 60000,
        });
      }

      if (p.provider === "anthropic") {
        const { ChatAnthropic } = await import("@langchain/anthropic");
        return new ChatAnthropic({
          model: p.model,
          apiKey: process.env.ANTHROPIC_API_KEY,
          temperature: temp,
          streaming: options?.streaming,
        });
      }

      if (p.provider === "openai") {
        const { ChatOpenAI } = await import("@langchain/openai");
        return new ChatOpenAI({
          model: p.model,
          apiKey: process.env.OPENAI_API_KEY,
          temperature: temp,
          streaming: options?.streaming,
        });
      }
    } catch (err) {
      console.warn(`[LLM] Failed to initialize ${p.provider}:`, (err as Error).message);
      continue; // Try next provider
    }
  }

  console.warn("[LLM] [WARN]  No LLM API key found or all providers failed.");
  return null;
}

/**
 * Check if an error is a rate-limit / quota error.
 */
function isRateLimitError(err: any): boolean {
    const msg = (err?.message || "").toLowerCase();
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
): Promise<{ content: string; provider: LLMProvider } | null> {
    const temp = options?.temperature ?? 0;
    const providerOrder = options?.providerOrder ?? DEFAULT_PROVIDER_ORDER;
    const orderedProviders = providerOrder
        .map((provider) => PROVIDERS.find((entry) => entry.provider === provider))
        .filter((entry): entry is ProviderConfig => entry !== undefined && isKeySet(entry.envKey));

    if (orderedProviders.length === 0) {
        console.warn("[LLM] No API keys configured for any provider.");
        return null;
    }

    let lastError: any = null;
    for (const p of orderedProviders) {
        try {
            console.log(`[LLM] Invoking ${p.provider.toUpperCase()} — ${p.model}...`);
            let model: any;

            if (p.provider === "gemini") {
                const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
                model = new ChatGoogleGenerativeAI({
                    model: p.model,
                    apiKey: process.env.GOOGLE_API_KEY,
                    temperature: temp,
                    streaming: options?.streaming,
                    maxRetries: 0,
                });
            } else if (p.provider === "groq") {
                const { ChatGroq } = await import("@langchain/groq");
                model = new ChatGroq({
                    model: p.model,
                    apiKey: process.env.GROQ_API_KEY,
                    temperature: temp,
                    streaming: options?.streaming,
                    maxRetries: 0,
                    timeout: 60000,
                });
            } else if (p.provider === "anthropic") {
                const { ChatAnthropic } = await import("@langchain/anthropic");
                model = new ChatAnthropic({
                    model: p.model,
                    apiKey: process.env.ANTHROPIC_API_KEY,
                    temperature: temp,
                    streaming: options?.streaming,
                });
            } else if (p.provider === "openai") {
                const { ChatOpenAI } = await import("@langchain/openai");
                model = new ChatOpenAI({
                    model: p.model,
                    apiKey: process.env.OPENAI_API_KEY,
                    temperature: temp,
                    streaming: options?.streaming,
                });
            } else {
                continue;
            }

            const response = options?.timeout
                ? await withTimeout(model.invoke(messages), `${p.provider} invoke`, options.timeout)
                : await model.invoke(messages);

            return { content: response.content as string, provider: p.provider };
        } catch (err: any) {
            lastError = err;
            const isRateLimit = isRateLimitError(err);
            console.warn(`[LLM] ${p.provider.toUpperCase()} failed: ${isRateLimit ? "RATE LIMIT" : err.message}`);
            if (!isRateLimit) {
                // Non-retryable error — do not try other providers
                break;
            }
            // Rate-limit: try next provider
            console.log(`[LLM] Falling back to next provider after ${p.provider} rate limit...`);
        }
    }

    console.error(`[LLM] All providers failed. Last error: ${lastError?.message}`);
    return null;
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
