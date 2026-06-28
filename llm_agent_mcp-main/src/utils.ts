export function extractJsonFromLlmResponse(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";

    const markdownMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (markdownMatch) {
        const inner = markdownMatch[1].trim();
        try {
            JSON.parse(inner);
            return inner;
        } catch {
        }
    }

    const jsonMatch = trimmed.match(/[\[{][\s\S]*[\]}]/);
    if (jsonMatch) {
        try {
            JSON.parse(jsonMatch[0]);
            return jsonMatch[0];
        } catch {
        }
    }

    return trimmed;
}

export function stripMarkdownFences(raw: string): string {
    return raw.replace(/```[\s\S]*?```/g, (match) => {
        const inner = match.replace(/```\w*\n?/, "").replace(/\n?```$/, "");
        return inner.trim();
    });
}

export function safeJsonParse<T>(raw: string, fallback: T): { data: T; cleaned: string } {
    const cleaned = extractJsonFromLlmResponse(raw);
    try {
        return { data: JSON.parse(cleaned) as T, cleaned };
    } catch {
        return { data: fallback, cleaned };
    }
}

export function buildSemanticGroups(cols: string[]): Record<string, string[]> {
    const groups: Record<string, string[]> = {};

    const prefixDefs: [RegExp, string][] = [
        [/^Mnt/i, "Spending (MNT)"],
        [/^Num/i, "Count/Web"],
        [/^Kidhome|^Teenhome/i, "Family Composition"],
        [/^Z_CostContact|^Z_Revenue/i, "Metadata"],
        [/^Accepted/i, "Campaign Acceptance"],
        [/^Complain/i, "Complaint"],
        [/^Response/i, "Response"],
        [/^Year/i, "Year"],
        [/^Income/i, "Income"],
        [/^Recency/i, "Recency"],
    ];

    for (const col of cols) {
        let assigned = false;
        for (const [pattern, groupName] of prefixDefs) {
            if (pattern.test(col)) {
                if (!groups[groupName]) groups[groupName] = [];
                groups[groupName].push(col);
                assigned = true;
                break;
            }
        }
        if (!assigned) {
            const catKeywords = /category|type|status|segment|group|class|region|city|country|gender|education|marital|deposit|loan|default|housing|contact|channel|product|brand|model/i;
            const dateKeywords = /date|time|timestamp|month|year|day|order_date|invoice/i;
            const idKeywords = /_id$|^id$|order_id|transaction|invoice_num/i;
            if (catKeywords.test(col)) {
                if (!groups["Categorical"]) groups["Categorical"] = [];
                groups["Categorical"].push(col);
            } else if (dateKeywords.test(col)) {
                if (!groups["Date/Time"]) groups["Date/Time"] = [];
                groups["Date/Time"].push(col);
            } else if (idKeywords.test(col)) {
                if (!groups["ID"]) groups["ID"] = [];
                groups["ID"].push(col);
            } else {
                if (!groups["Other"]) groups["Other"] = [];
                groups["Other"].push(col);
            }
        }
    }

    return groups;
}

export function formatSemanticGroups(groups: Record<string, string[]>): string {
    const entries = Object.entries(groups).filter(([_, cols]) => cols.length > 0);
    if (entries.length === 0) return "No semantic groups detected.";
    return entries.map(([group, cols]) => `- ${group}: ${cols.join(", ")}`).join("\n");
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function queryMentionsTable(query: string, tableName: string): boolean {
    const pattern = `\\b${escapeRegex(tableName.toLowerCase())}\\b`;
    return new RegExp(pattern).test(query.toLowerCase());
}

export function extractCodeBlock(raw: string, language?: string): string {
  if (language && raw.includes(`\`\`\`${language}`)) {
    return raw.split(`\`\`\`${language}`)[1].split("```")[0].trim();
  }
  if (raw.includes("```")) {
    return raw.split("```")[1].split("```")[0].trim();
  }
  return raw.trim();
}

function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.substring(i, i + 2));
  }
  return bigrams;
}

export function diceSimilarity(a: string, b: string): number {
  const bigramsA = getBigrams(a.toLowerCase());
  const bigramsB = getBigrams(b.toLowerCase());
  if (bigramsA.size === 0 && bigramsB.size === 0) return 1;
  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

const FUZZY_THRESHOLD = 0.4;

export function findClosestColumn(
  columns: string[],
  target: string,
  threshold: number = FUZZY_THRESHOLD
): string | null {
  let bestCol: string | null = null;
  let bestScore = threshold;
  for (const col of columns) {
    const score = diceSimilarity(col, target);
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }
  return bestCol;
}
