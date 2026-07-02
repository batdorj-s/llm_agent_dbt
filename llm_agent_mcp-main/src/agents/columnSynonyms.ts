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
    readonly description?: string;
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
    {
        concept: "finance_amount",
        // ^...$ exact match prevents "дүн" from matching "дүнгийн орлого" etc.
        patterns: [/^дүн$/i, /^amount$/i, /^мөнгө$/i, /^үнэ$/i, /^дүнгийн/i],
        description: "Transaction amount / Гүйлгээний дүн",
    },
    {
        concept: "finance_date",
        patterns: [/^өдөр$/i, /^огноо$/i, /^гүйлгээний.өдөр$/i],
        description: "Transaction date / Гүйлгээний огноо",
    },
    {
        concept: "finance_category",
        patterns: [/^ангилал$/i, /^төрөл$/i],
        description: "Transaction category / Ангилал",
    },
    {
        concept: "finance_subcategory",
        patterns: [/^дэд.ангилал$/i, /^subcategory$/i, /^дэд.төрөл$/i],
        description: "Transaction subcategory / Дэд ангилал",
    },
    {
        concept: "finance_party",
        patterns: [/^харилцагч$/i, /^counterparty$/i],
        description: "Transaction counterparty / Харилцагч",
    },
    {
        concept: "finance_note",
        patterns: [/^тайлбар$/i, /^утга$/i],
        description: "Transaction note / Тайлбар",
    },
];

const TABLE_SPECIFIC_COLUMNS: Record<string, Record<string, string[]>> = {
    "s": {
        "product": ["type"],
    },
    "superstore_sales": {
        "product": ["category"],
    },
    "transactions": {
        "finance_amount":      ["дүн"],
        "finance_date":        ["өдөр"],
        "finance_category":    ["ангилал"],
        "finance_subcategory": ["дэд_ангилал"],
        "finance_party":       ["харилцагч"],
        "finance_note":        ["тайлбар"],
    },
};

const TABLE_PREFIX_MAPPINGS: Record<string, Record<string, string[]>> = {
    // Any table starting with "sankhuu_" auto-inherits finance columns.
    // Supports sankhuu_2026_q1, sankhuu_2026_q2, sankhuu_2027, etc.
    "sankhuu_": {
        "finance_amount":      ["Дүн", "дүн"],
        "finance_date":        ["Өдөр", "өдөр"],
        "finance_category":    ["Ангилал", "ангилал"],
        "finance_subcategory": ["Дэд ангилал", "дэд_ангилал"],
        "finance_party":       ["Харилцагч", "харилцагч"],
        "finance_note":        ["Тайлбар", "тайлбар"],
    },
};

function matchColumnsFromMapping(
    mapping: Record<string, string[]> | undefined,
    columns: string[],
    concept: string,
): string | null {
    const exactColumns = mapping?.[concept];
    if (!exactColumns) return null;
    const lowerCols = columns.map((c) => c.toLowerCase());
    for (const exact of exactColumns) {
        const idx = lowerCols.indexOf(exact.toLowerCase());
        if (idx !== -1) return columns[idx];
    }
    return null;
}

export function findConceptColumn(
    columns: string[],
    concept: string,
    tableName?: string,
): string | null {
    if (tableName) {
        const lowerName = tableName.toLowerCase();
        // 1. Exact table match
        let result = matchColumnsFromMapping(TABLE_SPECIFIC_COLUMNS[lowerName], columns, concept);
        if (result) return result;

        // 2. Prefix match (e.g. sankhuu_* → finance columns)
        for (const [prefix, mapping] of Object.entries(TABLE_PREFIX_MAPPINGS)) {
            if (lowerName.startsWith(prefix)) {
                result = matchColumnsFromMapping(mapping, columns, concept);
                if (result) return result;
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
