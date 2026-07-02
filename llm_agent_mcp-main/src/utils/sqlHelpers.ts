/**
 * Testable SQL expression builders — shared between api-server and reportMetrics.
 */

/**
 * Builds a safe NUMERIC cast for MNT amount columns that may be stored as
 * TEXT "₮2,000,000" or already as NUMERIC.  Works in both cases because
 * REPLACE on a numeric-casted-to-text simply returns the plain digits.
 *
 * @param quotedCol — already-quoted identifier, e.g. '"дүн"'
 */
export function buildMntAmountExpr(quotedCol: string): string {
  return `CAST(REPLACE(REPLACE(${quotedCol}::TEXT, '₮', ''), ',', '') AS NUMERIC)`;
}

/**
 * Returns true when the column profile or column name suggests an MNT text
 * format (e.g. sample values contain ₮).
 */
export function looksLikeMntText(samples: string[]): boolean {
  return samples.some(s => s.includes("₮") || /^\d{1,3}(,\d{3})+$/.test(s));
}
