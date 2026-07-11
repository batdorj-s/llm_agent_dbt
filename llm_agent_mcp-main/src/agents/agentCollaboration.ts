/**
 * agentCollaboration.ts — Cross-agent collaboration mechanism
 *
 * Enables agents to share insights, context, and coordinate work.
 * Provides a shared context store and handoff protocols.
 */

import { createLogger } from "./logger.js";

const log = createLogger("AgentCollaboration");

// Shared context between agents
interface SharedInsight {
  id: string;
  agentName: string;
  timestamp: string;
  insightType: "data" | "analysis" | "recommendation" | "warning" | "kpi";
  content: string;
  metadata?: Record<string, unknown>;
}

interface AgentHandoff {
  fromAgent: string;
  toAgent: string;
  reason: string;
  context: Record<string, unknown>;
  timestamp: string;
}

// In-memory store (per-session, not persisted)
const sharedInsights: Map<string, SharedInsight[]> = new Map();
const agentHandoffs: Map<string, AgentHandoff[]> = new Map();

function getSessionId(userId?: string): string {
  return userId ?? "default";
}

export function shareInsight(
  insight: Omit<SharedInsight, "id" | "timestamp">,
  userId?: string
): SharedInsight {
  const sessionId = getSessionId(userId);
  const fullInsight: SharedInsight = {
    ...insight,
    id: `insight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };

  const existing = sharedInsights.get(sessionId) ?? [];
  sharedInsights.set(sessionId, [...existing, fullInsight]);

  log.info(`Shared insight from ${insight.agentName}`, {
    type: insight.insightType,
    content: insight.content.substring(0, 100),
  });

  return fullInsight;
}

export function getInsights(
  agentName?: string,
  insightType?: SharedInsight["insightType"],
  userId?: string
): SharedInsight[] {
  const sessionId = getSessionId(userId);
  const insights = sharedInsights.get(sessionId) ?? [];

  return insights.filter((insight) => {
    if (agentName && insight.agentName !== agentName) return false;
    if (insightType && insight.insightType !== insightType) return false;
    return true;
  });
}

export function recordHandoff(handoff: Omit<AgentHandoff, "timestamp">, userId?: string): void {
  const sessionId = getSessionId(userId);
  const fullHandoff: AgentHandoff = {
    ...handoff,
    timestamp: new Date().toISOString(),
  };

  const existing = agentHandoffs.get(sessionId) ?? [];
  agentHandoffs.set(sessionId, [...existing, fullHandoff]);

  log.info(`Agent handoff: ${handoff.fromAgent} → ${handoff.toAgent}`, {
    reason: handoff.reason,
  });
}

export function getHandoffs(userId?: string): AgentHandoff[] {
  const sessionId = getSessionId(userId);
  return agentHandoffs.get(sessionId) ?? [];
}

export function clearSession(userId?: string): void {
  const sessionId = getSessionId(userId);
  sharedInsights.delete(sessionId);
  agentHandoffs.delete(sessionId);
}

// Helper functions for common insight patterns
export function shareDataInsight(
  agentName: string,
  content: string,
  data?: Record<string, unknown>,
  userId?: string
): SharedInsight {
  return shareInsight(
    {
      agentName,
      insightType: "data",
      content,
      metadata: data,
    },
    userId
  );
}

export function shareAnalysisInsight(
  agentName: string,
  content: string,
  findings?: Record<string, unknown>,
  userId?: string
): SharedInsight {
  return shareInsight(
    {
      agentName,
      insightType: "analysis",
      content,
      metadata: findings,
    },
    userId
  );
}

export function shareKpiInsight(
  agentName: string,
  kpiName: string,
  value: number,
  unit: string,
  target?: number,
  userId?: string
): SharedInsight {
  return shareInsight(
    {
      agentName,
      insightType: "kpi",
      content: `${kpiName}: ${value.toLocaleString()} ${unit}`,
      metadata: {
        kpiName,
        value,
        unit,
        target,
        achieved: target ? value >= target : undefined,
      },
    },
    userId
  );
}

export function shareRecommendation(
  agentName: string,
  recommendation: string,
  reasoning: string,
  userId?: string
): SharedInsight {
  return shareInsight(
    {
      agentName,
      insightType: "recommendation",
      content: recommendation,
      metadata: { reasoning },
    },
    userId
  );
}

// Context aggregator for agents
export function getAggregatedContext(userId?: string): string {
  const insights = getInsights(undefined, undefined, userId);
  const handoffs = getHandoffs(userId);

  if (insights.length === 0 && handoffs.length === 0) {
    return "";
  }

  const lines: string[] = [];

  // Group insights by type
  const dataInsights = insights.filter((i) => i.insightType === "data");
  const analysisInsights = insights.filter((i) => i.insightType === "analysis");
  const kpiInsights = insights.filter((i) => i.insightType === "kpi");
  const recommendations = insights.filter((i) => i.insightType === "recommendation");

  if (dataInsights.length > 0) {
    lines.push("### Өгөгдлийн ойлголт");
    for (const insight of dataInsights.slice(-5)) {
      lines.push(`- ${insight.agentName}: ${insight.content}`);
    }
    lines.push("");
  }

  if (analysisInsights.length > 0) {
    lines.push("### Шинжилгээний дүгнэлт");
    for (const insight of analysisInsights.slice(-5)) {
      lines.push(`- ${insight.agentName}: ${insight.content}`);
    }
    lines.push("");
  }

  if (kpiInsights.length > 0) {
    lines.push("### KPI үзүүлэлт");
    for (const insight of kpiInsights.slice(-5)) {
      lines.push(`- ${insight.content}`);
    }
    lines.push("");
  }

  if (recommendations.length > 0) {
    lines.push("### Зөвлөмжүүд");
    for (const insight of recommendations.slice(-3)) {
      lines.push(`- ${insight.agentName}: ${insight.content}`);
    }
    lines.push("");
  }

  if (handoffs.length > 0) {
    lines.push("### Агентуудын хоорондын шилжүүлэг");
    for (const handoff of handoffs.slice(-3)) {
      lines.push(`- ${handoff.fromAgent} → ${handoff.toAgent}: ${handoff.reason}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
