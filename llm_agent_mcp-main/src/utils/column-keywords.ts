/**
 * column-keywords.ts — shared column-heuristic keyword lists.
 * Previously duplicated in whatif.router.ts and services/alerts.ts.
 */

/** Keywords used to identify numeric columns dynamically (EN + MN). */
export const NUMERIC_KEYWORDS: RegExp[] = [
  /age/i, /amount/i, /balance/i, /price/i, /cost/i, /revenue/i, /sales/i,
  /income/i, /profit/i, /spend/i, /value/i, /quantity/i, /count/i, /rate/i,
  /score/i, /total/i, /sum/i, /avg/i, /num/i, /rating/i, /expense/i,
  // Mongolian finance terms
  /зардал/i, /орлого/i, /ашиг/i, /дүн/i,
];

/** Keywords used to identify category/dimension-like columns (EN + MN). */
export const CATEGORY_KEYWORDS: RegExp[] = [
  /category/i, /type/i, /status/i, /segment/i, /channel/i, /product/i,
  /branch/i, /салбар/i, /бүтээгдэхүүн/i,
];

/** Keywords to identify potentially negative/profit-like columns. */
export const PROFIT_KEYWORDS: RegExp[] = [/profit/i, /ашиг/i, /цэвэр/i, /net/i];

/** Keywords to identify revenue/income-like columns. */
export const REVENUE_KEYWORDS: RegExp[] = [/revenue/i, /income/i, /орлого/i, /борлуулалт/i, /sales/i];

/** Keywords to identify expense-like columns. */
export const EXPENSE_KEYWORDS: RegExp[] = [/expense/i, /cost/i, /зардал/i, /зарлага/i, /spend/i];

export function isNumericColumnName(column: string): boolean {
  return NUMERIC_KEYWORDS.some(p => p.test(column));
}
