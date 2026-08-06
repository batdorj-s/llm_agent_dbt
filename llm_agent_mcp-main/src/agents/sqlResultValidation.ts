/**
 * sqlResultValidation.ts — Post-execution SQL result validation.
 *
 * The SQL retry loop already self-heals on empty results and schema errors.
 * These checks catch the harder "the query ran, but the answer is wrong" cases:
 *   - a column that comes back NULL for most rows (wrong column / over-filtered)
 *   - aggregate queries that return no meaningful numeric values
 *   - time-series results that collapse to a constant
 *
 * Each issue is phrased as retry feedback so the LLM can repair the SQL.
 */

export type ValidationSeverity = "low" | "medium" | "high";

export interface ValidationIssue {
  code: "high_null_ratio" | "no_numeric_values" | "constant_series" | "all_null_rows";
  column?: string;
  ratio?: number;
  severity: ValidationSeverity;
  message: string;
}

const NUMERIC_NULL_HIGH_RATIO = 0.6;

// ── Value helpers ─────────────────────────────────────────────

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && !isNaN(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || isNaN(Number(trimmed))) return null;
    return Number(trimmed);
  }
  return null;
}

function isBlankCell(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/**
 * Columns where more than half of non-blank cells parse as numbers.
 */
function numericColumns(rows: Record<string, unknown>[]): string[] {
  const keys = Object.keys(rows[0] ?? {});
  return keys.filter((key) => {
    const cells = rows.map((r) => r[key]).filter((v) => !isBlankCell(v));
    if (cells.length === 0) return false;
    const numericCount = cells.filter((v) => numericValue(v) !== null).length;
    return numericCount / cells.length > 0.5;
  });
}

// ── Main validation ───────────────────────────────────────────

/**
 * Validate the rows returned by a SQL execution.
 * Returns [] when the result looks trustworthy.
 */
export function validateSqlResult(rows: unknown[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(rows)) return issues;
  if (rows.length === 0) {
    issues.push({
      code: "all_null_rows",
      severity: "low",
      message:
        "ResultSet is empty. The query matched no rows — it may rely on a non-existent category label or an over-restrictive filter.",
    });
    return issues;
  }

  const typed = rows as Record<string, unknown>[];

  const allBlank = typed.every(
    (r) =>
      Object.keys(r).length === 0 ||
      Object.values(r).every((v) => isBlankCell(v))
  );
  if (allBlank) {
    issues.push({
      code: "all_null_rows",
      severity: "high",
      message:
        "Every returned row is empty/NULL. The projected columns are probably wrong or the WHERE clause excludes everything. Rebuild the SELECT using real column names.",
    });
    return issues;
  }

  const numericCols = numericColumns(typed);

  if (numericCols.length === 0) {
    issues.push({
      code: "no_numeric_values",
      severity: "medium",
      message:
        "Result contains no numeric measurements — likely the wrong measure column was selected, or values were cast incorrectly. Verify the amount/income/sales column.",
    });
    return issues;
  }

  for (const col of numericCols) {
    const cells = typed.map((r) => r[col]);
    const nullCells = cells.filter((v) => isBlankCell(v));
    const nullRatio = cells.length > 0 ? nullCells.length / cells.length : 1;

    if (nullRatio >= NUMERIC_NULL_HIGH_RATIO) {
      issues.push({
        code: "high_null_ratio",
        severity: "medium",
        column: col,
        ratio: nullRatio,
        message:
          `Column "${col}" is NULL in ${(nullRatio * 100).toFixed(0)}% of rows. ` +
          `The query is mapping the wrong source column or the row filter is too strict. Pick the real amount column from the schema.`,
      });
      continue;
    }

    const values = cells
      .map((v) => numericValue(v))
      .filter((v): v is number => v !== null);
    const distinct = new Set(values).size;
    if (typed.length >= 6 && distinct <= 1) {
      issues.push({
        code: "constant_series",
        severity: "low",
        column: col,
        message:
          `Column "${col}" is constant across all rows. For a breakdown/monthly query this usually means the GROUP BY key or a CASE expression is wrong.`,
      });
    }
  }

  // De-duplicate issues produced by the same root cause.
  const seen = new Set<string>();
  const unique: ValidationIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}::${issue.column ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique;
}

/**
 * Render issues as retry feedback text (Mongolian) for the SQL retry loop.
 */
export function formatValidationFeedback(issues: ValidationIssue[]): string {
  if (issues.length === 0) return "";
  const lines = issues.map((i) => `- [${i.severity}] ${i.message}`);
  return [
    "Error: The SQL executed but the returned data is structurally suspicious:",
    ...lines,
    "Please fix the query and return a corrected version.",
  ].join("\n");
}