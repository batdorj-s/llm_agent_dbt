/**
 * generateFollowUpSuggestions.ts — #6 Dynamic follow-up suggestions
 *
 * Analyzes the last response and user query to produce contextual
 * follow-up suggestions instead of static per-agent-type lists.
 */

interface Suggestion {
  label: string;
  query: string;
}

// Detect if the response contains tabular / SQL result data
function hasTableData(text: string): boolean {
  return text.includes("```json") || text.includes("| ") || text.includes('"ангилал"') || text.includes('"нийт_дүн"');
}

// Detect if the response mentions specific data concepts
function mentions(text: string, ...keywords: string[]): boolean {
  return keywords.some(k => text.includes(k));
}

// Extract a meaningful noun phrase from the user query for reuse in suggestions
function extractTopic(query: string): string {
  const cleaned = query.replace(/[?!.]+$/g, "").trim();
  // Return the query itself if short enough
  if (cleaned.length <= 30) return cleaned;
  return cleaned.slice(0, 28) + "...";
}

/**
 * Given the last user query and the last assistant response,
 * produce 3–6 contextual follow-up suggestions.
 */
export function generateFollowUpSuggestions(
  lastQuery: string,
  lastResponse: string,
  lastAgentType: string | null,
): Suggestion[] {
  if (!lastResponse) return [];

  const suggestions: Suggestion[] = [];
  const topic = extractTopic(lastQuery);
  const response = lastResponse;

  // ── Universal follow-ups ──────────────────────────────────
  // Always offer chart/dashboard if data was returned
  if (hasTableData(response)) {
    suggestions.push({
      label: "Графикаар харуул",
      query: `Энэ өгөгдлийг график болгож харуул`,
    });
  }

  // ── Finance-specific ──────────────────────────────────────
  if (lastAgentType === "Finance Agent" || mentions(response, "Finance Agent", "зарлага", "орлого", "санхүү", "мөнгөн урсгал")) {
    if (mentions(response, "нийт_дүн", "сумаар", "Sum", "SUM")) {
      suggestions.push({
        label: "Ангилалаар задал",
        query: `${topic}-г ангилал бүрээр дэлгэрүүлж үзүүл`,
      });
    }
    if (hasTableData(response)) {
      suggestions.push({
        label: "Сараар харьцуулах",
        query: `${topic}-г сараар харьцуулж харуул`,
      });
      suggestions.push({
        label: "Dashboard болгож харуул",
        query: `${topic}-г dashboard болгож харуул`,
      });
    }
    suggestions.push({
      label: "Тайлан гаргах",
      query: `${topic}-н тайлан гаргаж өгнө үү`,
    });
  }

  // ── Tech / SQL-specific ───────────────────────────────────
  if (lastAgentType === "Tech Agent" || mentions(response, "Tech Agent", "SQL", "execute_sql", "query")) {
    if (hasTableData(response)) {
      suggestions.push({
        label: "Top 5-ыг харуул",
        query: `${topic}-н эхний 5-ыг харуул`,
      });
      suggestions.push({
        label: "Харьцуулалт хий",
        query: `${topic}-г өмнөх сартай харьцуул`,
      });
    }
    suggestions.push({
      label: "Өгөгдлийг шүү",
      query: `${topic}-г нэмэлт нөхцөлөөр шүүж харуул`,
    });
  }

  // ── Data Scientist-specific ───────────────────────────────
  if (lastAgentType === "DataScientistAgent" || mentions(response, "DataScientist", "forecast", "cluster", "тамаглал")) {
    suggestions.push({
      label: "Корреляци хар",
      query: `${topic}-н хоорондын корреляцийг харуул`,
    });
    suggestions.push({
      label: "Тамаглал шинэчил",
      query: `Шинэ өгөгдлөөр тамаглалаа шинэчил`,
    });
  }

  // ── Chart response follow-ups ─────────────────────────────
  if (mentions(response, "<visual>", "<dashboard>", "chart", "graph")) {
    suggestions.push({
      label: "Өөр төрлийн график",
      query: `Энэ өгөгдлийг өөр төрлийн графикээр харуул`,
    });
  }

  // ── Fallback: always offer at least something useful ──────
  if (suggestions.length === 0) {
    suggestions.push(
      { label: "Дэлгэрэнгүй тайлбарла", query: `${topic}-г дэлгэрэнгүй тайлбарла` },
      { label: "График зур", query: `${topic}-г графикээр харуул` },
    );
  }

  // Cap at 6 suggestions to avoid UI overflow
  return suggestions.slice(0, 6);
}
