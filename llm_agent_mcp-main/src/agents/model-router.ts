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

// ── Query-complexity classification (D1) ──────────────────────

/**
 * Signals that push a TechAgent (SQL) query into the "capable" tier — the
 * stronger providers are measurably better at multi-table joins, window
 * functions, and comparative time-series SQL.
 */
const COMPLEX_QUERY_SIGNALS: RegExp[] = [
  /join|хамт\s+хүснэгт|хоёр\s+хүснэгт|холбоо/i,
  /forecast|таамаглал|урьдчилан\s+таамаг|clustering|бүлэглэл|correlation|хамаарал|regression|регресс/i,
  /anomaly|гажуудал|outlier|аномали|стандарт\s+хазайлт|z-score/i,
  /trend|тренд|улирлын|seasonal|seasonality/i,
  /өмнөх\s+жил|previous\s+year|last\s+year|yoy|year.over.year|жилийн\s+өсөлт/i,
  /хөдөлгөөнт\s+дундаж|moving\s+average|rolling|цуврал\s+нийлбэр|running\s+total|cumulative|ytd/i,
  /нийтийн\s+хувь|percent.of.total|пропорц|proportion/i,
  /зэрэглэл|rank|топ\s+лист|top\s+list/i,
  /давхар\s+харьцуулалт|multi.metric|олон\s+үзүүлэлт|ratio|харьцаа/i,
];

export function classifyModelTierForQuery(query: string): ModelTier {
  const lower = query.toLowerCase();
  return COMPLEX_QUERY_SIGNALS.some((signal) => signal.test(lower)) ? "capable" : "fast";
}
