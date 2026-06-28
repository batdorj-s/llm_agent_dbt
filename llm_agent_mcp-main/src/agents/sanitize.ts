/**
 * Sanitize user input for prompt injection protection.
 * Strips known prompt override patterns and truncates excessively long input.
 *
 * Column name sanitizer for SQL identifier protection.
 */

const INJECTION_PATTERNS = [
  /\bignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|commands?|directions?)/gi,
  /\bforget\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|commands?|directions?)/gi,
  /\bdisregard\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|commands?|directions?)/gi,
  /\bdo\s+(not|n't)\s+(follow|obey|listen\s+to)\s+(the\s+)?(previous|above|prior)/gi,
  /\bnew\s+instructions?\b[\s\S]{0,100}?:/gi,
  /\boverride\b[\s\S]{0,100}?:/gi,
  /\byou\s+are\s+(now|henceforth)\b[\s\S]{0,100}?:/gi,
  /\bact\s+as\b/gi,
  /\bsystem\s+(prompt|message|instruction)\b[\s\S]{0,100}?:/gi,
];

const MAX_INPUT_LENGTH = 2000;

export function sanitizeUserInput(input: string): string {
  let cleaned = input.trim().slice(0, MAX_INPUT_LENGTH);
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[redacted]");
  }
  return cleaned;
}

const COLUMN_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Validate a column name for safe use in SQL identifiers.
 * Returns the column name if valid, or undefined if it contains unsafe characters.
 * This is a defense-in-depth measure — column names are already sanitized
 * at CSV import time via normalizeColumnName().
 */
export function sanitizeColumnName(name: string): string | undefined {
  if (!name || typeof name !== "string") return undefined;
  if (name.length > 128) return undefined; // max PG identifier length
  const trimmed = name.trim();
  if (!COLUMN_NAME_RE.test(trimmed)) return undefined;
  return trimmed;
}
