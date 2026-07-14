import type { LLMProvider } from "../llm-provider.js";

export type ModelTier = "fast" | "capable" | "auto";

export interface TierConfig {
  label: string;
  description: string;
  providerOrder: LLMProvider[];
}

const TIER_CONFIGS: Record<ModelTier, TierConfig> = {
  fast: {
    label: "Fast / cheap",
    description: "Simple tasks: SQL generation, basic Q&A, explanation. Prefers Groq (free, fast).",
    providerOrder: ["groq", "gemini", "anthropic", "openai"],
  },
  capable: {
    label: "Capable / accurate",
    description: "Complex tasks: forecasting, clustering, anomaly detection, correlation, regression. Prefers Gemini or better.",
    providerOrder: ["gemini", "anthropic", "groq", "openai"],
  },
  auto: {
    label: "Auto (fallback)",
    description: "Default order from llm-provider.",
    providerOrder: [],
  },
};

export function getProviderOrder(tier: ModelTier): LLMProvider[] {
  const cfg = TIER_CONFIGS[tier];
  if (!cfg || tier === "auto") return [];
  return cfg.providerOrder;
}

export function getTierLabel(tier: ModelTier): string {
  return TIER_CONFIGS[tier]?.label ?? "auto";
}

export function getTierDescription(tier: ModelTier): string {
  return TIER_CONFIGS[tier]?.description ?? "Default provider order.";
}

export function routeTierForAgent(nextAgent: string): ModelTier {
  switch (nextAgent) {
    case "DataScientistAgent":
      return "capable";
    case "TechAgent":
    case "FinanceAgent":
    default:
      return "fast";
  }
}
