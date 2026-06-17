/**
 * llm-provider.ts — Free LLM Provider Auto-Selector
 *
 * Automatically picks the best available free LLM based on your .env keys.
 * Priority order: Google Gemini Flash → Groq → Anthropic → OpenAI
 *
 * Free API Keys:
 *  🥇 Google AI Studio (Gemini 2.0 Flash) — https://aistudio.google.com/app/apikey
 *     → 1,500 requests/day FREE, no credit card
 *
 *  🥈 Groq (Llama 3.3 70B)               — https://console.groq.com/keys
 *     → 14,400 requests/day FREE, blazing fast (~500 tok/s), no credit card
 *
 *  🥉 Mistral (Mistral Small)             — https://console.mistral.ai/api-keys/
 *     → ~1B tokens/month FREE, no credit card
 *
 * Add your chosen key(s) to .env:
 *   GOOGLE_API_KEY=...
 *   GROQ_API_KEY=...
 */

import dotenv from "dotenv";
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
    model: "gemini-1.5-flash",
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
  return createLLMWithOrder(options);
}

export async function createLLMWithOrder(options?: { temperature?: number; streaming?: boolean; providerOrder?: LLMProvider[] }) {
  const temp = options?.temperature ?? 0;
  const providerOrder = options?.providerOrder ?? DEFAULT_PROVIDER_ORDER;
  const orderedProviders = providerOrder
    .map((provider) => PROVIDERS.find((entry) => entry.provider === provider))
    .filter((entry): entry is ProviderConfig => Boolean(entry));

  for (const p of orderedProviders) {
    if (!isKeySet(p.envKey)) continue;

    console.log(`[LLM] Using ${p.provider.toUpperCase()} — ${p.model} ${p.isFree ? "🆓" : "💳"}`);

    if (p.provider === "gemini") {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      return new ChatGoogleGenerativeAI({
        model: p.model,
        apiKey: process.env.GOOGLE_API_KEY,
        temperature: temp,
        streaming: options?.streaming,
      });
    }

    if (p.provider === "groq") {
      const { ChatGroq } = await import("@langchain/groq");
      return new ChatGroq({
        model: p.model,
        apiKey: process.env.GROQ_API_KEY,
        temperature: temp,
        streaming: options?.streaming,
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
  }

  console.warn("[LLM] ⚠️  No LLM API key found. Add one of: GOOGLE_API_KEY, GROQ_API_KEY");
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
    const badge  = p.isFree ? "🆓" : "💳";
    const status = active ? "✅ ACTIVE" : "⬜ not set";
    console.log(`║ ${badge} ${p.provider.padEnd(10)} ${p.model.padEnd(28)} ${status} ║`);
  }
  console.log("╚══════════════════════════════════════════════════════╝\n");
}
