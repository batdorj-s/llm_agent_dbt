// ── Column Synonym Mapping ─────────────────────────────────────────────
// Purpose: Map semantic concepts ("sales", "product", "date", "quantity")
// to actual column names across different tables.
//
// Architecture (two-layer fallback):
//   1. TABLE_SPECIFIC_COLUMNS — exact column names per table (highest priority).
//      Add an entry here when a table uses an unconventional column name
//      (e.g. "s" table uses "type" for product category, not "product").
//   2. GLOBAL_CONCEPTS — regex patterns that work across most tables.
//      Patterns are ordered by specificity — first match wins, but
//      columns that also match another concept's patterns are skipped
//      (ambiguity avoidance), falling through to the next pattern.
//
// To add support for a new table:
//   Add an entry to TABLE_SPECIFIC_COLUMNS — no code changes needed.
//   Only add global patterns if the column name pattern is truly universal.
//
// Rule of thumb: if a column name would match patterns from multiple
// concepts (e.g. "sales_category" matches both /sales/i and /category/i),
// use a table-specific override to pin it to the correct concept.
// ────────────────────────────────────────────────────────────────────────

export interface ColumnConcept {
    readonly concept: string;
    readonly patterns: RegExp[];
}

export const GLOBAL_CONCEPTS: ColumnConcept[] = [
    {
        concept: "sales",
        patterns: [
            /sales/i, /revenue/i,
            /amount/i, /purchase_amount/i, /total_amount/i, /profit/i,
        ],
    },
    {
        concept: "product",
        patterns: [
            /product/i, /product_category/i, /item_purchased/i,
            /item/i, /category/i,
        ],
    },
    {
        concept: "date",
        patterns: [/date/i, /order_date/i, /time/i],
    },
    {
        concept: "quantity",
        patterns: [/quantity/i, /qty/i],
    },
    {
        concept: "income",
        patterns: [
            /gross_income/i, /income/i,
        ],
    },
];

const TABLE_SPECIFIC_COLUMNS: Record<string, Record<string, string[]>> = {
    "s": {
        "product": ["type"],
    },
    "superstore_sales": {
        "product": ["category"],
    },
};

export function findConceptColumn(
    columns: string[],
    concept: string,
    tableName?: string,
): string | null {
    if (tableName) {
        const tableMap = TABLE_SPECIFIC_COLUMNS[tableName.toLowerCase()];
        const exactColumns = tableMap?.[concept];
        if (exactColumns) {
            const lowerCols = columns.map((c) => c.toLowerCase());
            for (const exact of exactColumns) {
                const idx = lowerCols.indexOf(exact.toLowerCase());
                if (idx !== -1) return columns[idx];
            }
        }
    }

    const conceptDef = GLOBAL_CONCEPTS.find((c) => c.concept === concept);
    if (!conceptDef) return null;

    const otherPatterns = GLOBAL_CONCEPTS
        .filter((c) => c.concept !== concept)
        .flatMap((c) => c.patterns);

    let fallback: string | null = null;

    for (const pattern of conceptDef.patterns) {
        const match = columns.find((column) => pattern.test(column));
        if (match) {
            const isAmbiguous = otherPatterns.some((p) => p.test(match));
            if (!isAmbiguous) return match;
            if (!fallback) fallback = match;
        }
    }

    return fallback;
}
