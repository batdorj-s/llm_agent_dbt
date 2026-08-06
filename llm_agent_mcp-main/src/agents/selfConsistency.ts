/**
 * selfConsistency.ts — Lightweight self-consistency for SQL results.
 *
 * For complex ("capable") queries, generate a second, independent SQL candidate
 * and compare shapes. We only adopt the second candidate in the clearly-safe
 * case: identical output columns, but the first candidate returned suspiciously
 * few rows (< 5) while the second returned a full result set (>= 5 rows).
 * Everything else keeps the original result — we never destabilize a good answer.
 */

import { extractCodeBlock, safeJsonParse } from "../utils.js";

export const CONSISTENCY_VOTE_ENABLED =
  process.env.CONSISTENCY_VOTE !== "false";

export function sameColumnKeys(a: Record<string, unknown>[], b: Record<string, unknown>[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const keySet = (rows: Record<string, unknown>[]) =>
    new Set(rows.map((r) => Object.keys(r).sort().join("|")));
  const aKeys = keySet(a);
  const bKeys = keySet(b);
  if (aKeys.size === 0 || bKeys.size === 0) return false;
  return [...aKeys][0] === [...bKeys][0];
}

/**
 * Pure decision: should we adopt the second candidate?
 * - second must be non-empty and have the same column shape
 * - first looks truncated/weak (< 5 rows) while second is complete (>= 5 rows)
 */
export function shouldAdoptCandidate(
  firstRows: unknown[],
  secondRows: unknown[]
): boolean {
  if (!Array.isArray(secondRows) || secondRows.length === 0) return false;
  const first = firstRows as Record<string, unknown>[];
  const second = secondRows as Record<string, unknown>[];
  if (!sameColumnKeys(first, second)) return false;
  return first.length < 5 && second.length >= 5;
}

const ALTERNATIVE_SQL_PROMPT = `You are a senior SQL Data Engineer. The user asked the following question and a first SQL already produced an answer:

Question: "{query}"

First SQL:
\`\`\`sql
{firstSql}
\`\`\`

First result rows: {firstRowCount}

Generate a DIFFERENT but semantically equivalent PostgreSQL query for the same question.
Use a different construction (different grouping, filtering or ordering approach), but keep the same meaning.
Return ONLY the SQL inside a markdown \`\`\`sql block. No explanation.`;

export async function performConsistencyCheck(params: {
  query: string;
  firstSql: string;
  firstResult: string;
  schemaContext: string;
  ragContext: string;
  providerOrder?: unknown[];
  invoke: (
    messages: { role: string; content: string }[],
    options?: { temperature?: number; timeout?: number; providerOrder?: unknown[] }
  ) => Promise<{ content: string }>;
  executeSql: (params: { query: string; userId: string }) => Promise<{ ok: boolean; text: string; results?: unknown }>;
  userId: string;
}): Promise<{ adopted: boolean; sql: string; text: string }> {
  if (!CONSISTENCY_VOTE_ENABLED) return { adopted: false, sql: params.firstSql, text: params.firstResult };

  const firstParsed = safeJsonParse(params.firstResult, []);
  const firstRows = Array.isArray(firstParsed.data) ? firstParsed.data : [];

  const prompt = ALTERNATIVE_SQL_PROMPT
    .replace("{query}", params.query.slice(0, 300))
    .replace("{firstSql}", params.firstSql)
    .replace("{firstRowCount}", String(firstRows.length));

  let secondSql = "";
  try {
    const response = await params.invoke(
      [
        {
          role: "system",
          content:
            params.schemaContext +
            params.ragContext +
            "\n\n" +
            "## Instructions\n" +
            prompt,
        },
        { role: "user", content: `Question: ${params.query}` },
      ],
      { temperature: 0.6, timeout: 45000, providerOrder: params.providerOrder }
    );
    secondSql = extractCodeBlock(response.content, "sql") || response.content.trim();
    if (!secondSql) return { adopted: false, sql: params.firstSql, text: params.firstResult };
  } catch {
    return { adopted: false, sql: params.firstSql, text: params.firstResult };
  }

  try {
    const result = await params.executeSql({ query: secondSql, userId: params.userId });
    if (!result.ok) return { adopted: false, sql: params.firstSql, text: params.firstResult };
    const secondParsed = safeJsonParse(result.text, []);
    const secondRows = Array.isArray(secondParsed.data) ? secondParsed.data : [];

    if (shouldAdoptCandidate(firstRows, secondRows)) {
      return { adopted: true, sql: secondSql, text: result.text };
    }
    return { adopted: false, sql: params.firstSql, text: params.firstResult };
  } catch {
    return { adopted: false, sql: params.firstSql, text: params.firstResult };
  }
}
