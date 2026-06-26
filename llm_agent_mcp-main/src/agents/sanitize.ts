/**
 * Sanitize user input for prompt injection protection.
 * Strips known prompt override patterns and truncates excessively long input.
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
