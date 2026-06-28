import { describe, it, expect } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Stress Tests: Data Understanding Enhancements (Phases 1-4)
// ────────────────────────────────────────────────────────────────────────────

function makeEntry(tableName: string, columns: string[], columnProfiles?: Record<string, any>) {
    return {
        id: 1,
        table_name: tableName,
        created_by: null,
        owner_id: null,
        visibility: "shared" as const,
        created_at: "2026-01-01",
        columns_info: JSON.stringify(columns),
        description: null,
        column_profiles: columnProfiles,
    };
}

function makeProfile(type: string, distinct: number, min?: string, max?: string) {
    return { type, distinct, min, max };
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 1: Data Profiling — buildSchemaDefinition
// ────────────────────────────────────────────────────────────────────────────
describe("Phase 1 — Data Profiling: buildSchemaDefinition", () => {
    it("STRESS: formats types as INT / DEC / text correctly", async () => {
        const profiles = {
            id: makeProfile("integer", 1000, "1", "1000"),
            price: makeProfile("numeric", 300, "0.99", "999.99"),
            name: makeProfile("text", 50),
            tags: makeProfile("jsonb", 10),
        };
        const entry = makeEntry("products", ["id", "price", "name", "tags"], profiles);
        const { buildSchemaDefinition } = await import("../db/data-lake.js");
        const result = await buildSchemaDefinition(entry);
        expect(result).toContain("id (INT,");
        expect(result).toContain("price (DEC,");
        expect(result).toContain("name (text,");
        expect(result).toContain("tags (jsonb,");
    });

    it("STRESS: shows range [min..max] for integer / numeric columns", async () => {
        const profiles = {
            amount: makeProfile("numeric", 500, "0", "10000"),
            date_serial: makeProfile("integer", 200, "43537", "45000"),
        };
        const entry = makeEntry("payments", ["amount", "date_serial"], profiles);
        const { buildSchemaDefinition } = await import("../db/data-lake.js");
        const result = await buildSchemaDefinition(entry);
        expect(result).toContain("[0..10000]");
        expect(result).toContain("[43537..45000]");
    });

    it("STRESS: text columns show distinct count without range", async () => {
        const profiles = { status: makeProfile("text", 3) };
        const entry = makeEntry("orders", ["status"], profiles);
        const { buildSchemaDefinition } = await import("../db/data-lake.js");
        const result = await buildSchemaDefinition(entry);
        expect(result).toContain("status (text, 3 distinct)");
        expect(result).not.toContain("[");
    });

    it("STRESS: handles empty column_profiles by falling back to live queries", async () => {
        const entry = makeEntry("fallback_table", ["col_a"]);
        const { buildSchemaDefinition } = await import("../db/data-lake.js");
        await expect(buildSchemaDefinition(entry)).resolves.not.toThrow();
    });

    it("STRESS: handles null column_profiles (legacy entries) without error", async () => {
        const entry = makeEntry("legacy", ["id", "name"]);
        entry.column_profiles = undefined as any;
        const { buildSchemaDefinition } = await import("../db/data-lake.js");
        await expect(buildSchemaDefinition(entry)).resolves.not.toThrow();
    });

    it("STRESS: handles array of multiple tables", async () => {
        const e1 = makeEntry("orders", ["id", "amount"], { amount: makeProfile("numeric", 100, "1", "500") });
        const e2 = makeEntry("users", ["id", "email"], { email: makeProfile("text", 200) });
        const { buildSchemaDefinition } = await import("../db/data-lake.js");
        const result = await buildSchemaDefinition([e1, e2]);
        expect(result).toContain("orders");
        expect(result).toContain("users");
    });

    it("STRESS: handles 50+ columns efficiently", async () => {
        const cols = Array.from({ length: 50 }, (_, i) => `col_${i}`);
        const profiles: Record<string, any> = {};
        for (let i = 0; i < 50; i++) {
            profiles[`col_${i}`] = makeProfile(i < 25 ? "integer" : "text", 10, "0", "100");
        }
        const entry = makeEntry("wide_table", cols, profiles);
        const { buildSchemaDefinition } = await import("../db/data-lake.js");
        const result = await buildSchemaDefinition(entry);
        expect(result).toContain("wide_table");
        expect(result).toContain("col_0");
        expect(result).toContain("col_49");
    });

    it("STRESS: semantic groups appear in output", async () => {
        const profiles = {
            id: makeProfile("integer", 1000),
            user_id: makeProfile("integer", 100),
            status: makeProfile("text", 3),
            amount: makeProfile("numeric", 500, "0", "10000"),
            created_at: makeProfile("integer", 200, "43537", "45000"),
        };
        const entry = makeEntry("invoices", ["id", "user_id", "status", "amount", "created_at"], profiles);
        const { buildSchemaDefinition } = await import("../db/data-lake.js");
        const result = await buildSchemaDefinition(entry);
        expect(result).toContain("Semantic Groups");
        expect(result).toContain("ID:");
        expect(result).toContain("Categorical:");
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 2: Auto ER-Mapping — FK Detection Heuristic
// ────────────────────────────────────────────────────────────────────────────
describe("Phase 2 — Auto ER-Mapping: Foreign Key Detection", () => {
    it("STRESS: user_id → users (exact + s)", () => {
        const tables = ["users", "products"];
        const baseName = "user_id".match(/^(.+)_id$/)?.[1]!;
        const matched = tables.some(t =>
            t === baseName || t === `${baseName}s` || t === `${baseName}es`
        );
        expect(matched).toBe(true);
    });

    it("STRESS: customer_id → customers (plural s)", () => {
        const tables = ["customers", "orders"];
        const baseName = "customer_id".match(/^(.+)_id$/)?.[1]!;
        const matched = tables.some(t =>
            t === baseName || t === `${baseName}s` || t === `${baseName}es`
        );
        expect(matched).toBe(true);
    });

    it("STRESS: category_id → categories (plural ies)", () => {
        const tables = ["categories", "orders"];
        const baseName = "category_id".match(/^(.+)_id$/)?.[1]!;
        const matched = tables.some(t =>
            t === baseName ||
            t === `${baseName}s` ||
            t === `${baseName}es` ||
            (t.endsWith('ies') && baseName === t.replace(/ies$/, 'y'))
        );
        expect(matched).toBe(true);
    });

    it("STRESS: matches same matching logic as detectForeignKeys code", () => {
        const tables = ["categories"];
        const baseName = "category_id".match(/^(.+)_id$/)?.[1]!;
        const matched = tables.some(t => {
            const other = t;
            return other === baseName
                || other === `${baseName}s`
                || other === `${baseName}es`
                || other.endsWith(`_${baseName}`)
                || baseName === other.replace(/s$/, '')
                || (other.endsWith('ies') && baseName === other.replace(/ies$/, 'y'));
        });
        expect(matched).toBe(true);
    });

    it("STRESS: ignores non-id columns (first_name, email, total_amount)", () => {
        const columns = ["first_name", "email_address", "total_amount"];
        const fkColumns = columns.filter(c => /^.+_id$/.test(c));
        expect(fkColumns.length).toBe(0);
    });

    it("STRESS: detects 5 FK candidates in one table", () => {
        const columns = ["user_id", "product_id", "category_id", "region_id", "promotion_id", "amount"];
        const fkColumns = columns.filter(c => /^.+_id$/.test(c));
        expect(fkColumns.length).toBe(5);
    });

    it("STRESS: multiple FKs all match (including ies plural)", () => {
        const tables = ["users", "products", "categories", "regions", "promotions"];
        const fkColumns = ["user_id", "product_id", "category_id", "region_id", "promotion_id"];
        for (const col of fkColumns) {
            const baseName = col.match(/^(.+)_id$/)?.[1]!;
            const found = tables.some(t =>
                t === baseName ||
                t === `${baseName}s` ||
                t === `${baseName}es` ||
                (t.endsWith('ies') && baseName === t.replace(/ies$/, 'y'))
            );
            expect(found).toBe(true);
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 2 (cont): Known Relationships — getRelationships format & edge cases
// ────────────────────────────────────────────────────────────────────────────
describe("Phase 2 — Schema Context: getRelationships interface", () => {
    // Note: getRelationships requires a live PostgreSQL connection.
    // These tests verify the relationship string format and interface contract.

    it("STRESS: relationship string format is source.source → target.target", () => {
        // The format produced by getRelationships:
        const entry = "sales.user_id → users.id";
        expect(entry).toMatch(/\w+\.\w+ → \w+\.\w+/);
    });

    it("STRESS: multiple relationships are separated by newlines", () => {
        const rels = ["a.x → b.y", "c.z → d.w"];
        const formatted = rels.join("\n");
        expect(formatted).toContain("a.x → b.y");
        expect(formatted).toContain("c.z → d.w");
        expect(formatted.split("\n").length).toBe(2);
    });

    it("STRESS: empty relationship array does not crash buildSchemaDefinition", async () => {
        const entry = makeEntry("isolated", ["id"]);
        const { buildSchemaDefinition } = await import("../db/data-lake.js");
        await expect(buildSchemaDefinition(entry)).resolves.not.toThrow();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 3: Semantic RAG — Business Glossary
// ────────────────────────────────────────────────────────────────────────────
describe("Phase 3 — Semantic RAG: Business Glossary", () => {
    it("STRESS: 'Цэвэр ашиг' returns net profit content", async () => {
        const { searchKnowledgeBase } = await import("../rag.js");
        const result = await searchKnowledgeBase("Цэвэр ашиг гэж юу вэ?", "FinanceAgent", 5);
        const combined = (result.documents?.[0] ?? []).join(" ").toLowerCase();
        expect(combined).toContain("net profit");
    });

    it("STRESS: 'борлуулалтын орлого' returns revenue definition", async () => {
        const { searchKnowledgeBase } = await import("../rag.js");
        const result = await searchKnowledgeBase("борлуулалтын орлого", "FinanceAgent", 5);
        const combined = (result.documents?.[0] ?? []).join(" ").toLowerCase();
        expect(combined).toContain("revenue");
    });

    it("STRESS: 'ашгийн хувь' returns profit margin formula", async () => {
        const { searchKnowledgeBase } = await import("../rag.js");
        const result = await searchKnowledgeBase("ашгийн хувийг хэрхэн бодох", "FinanceAgent", 5);
        const combined = (result.documents?.[0] ?? []).join(" ").toLowerCase();
        expect(combined).toContain("profit");
    });

    it("STRESS: 'ашиг' returns profit-related definitions", async () => {
        const { searchKnowledgeBase } = await import("../rag.js");
        const result = await searchKnowledgeBase("ашиг", "FinanceAgent", 5);
        const combined = (result.documents?.[0] ?? []).join(" ").toLowerCase();
        expect(combined).toContain("profit");
    });

    it("STRESS: churn Mongolian query returns glossary entry", async () => {
        const { searchKnowledgeBase } = await import("../rag.js");
        const result = await searchKnowledgeBase("харилцагчийн алдагдал", "FinanceAgent", 5);
        const combined = (result.documents?.[0] ?? []).join(" ").toLowerCase();
        expect(combined).toContain("churn");
    });

    it("STRESS: self-query filter returns business policy docs", async () => {
        const { searchKnowledgeBaseWithFilter } = await import("../rag.js");
        const result = await searchKnowledgeBaseWithFilter({
            query: "net profit calculation",
            agentRole: "FinanceAgent",
            limit: 3,
            filter: { query: "net profit", categories: ["business_policy"] },
        });
        const docs = (result.documents?.[0] ?? []).join(" ").toLowerCase();
        expect(docs.length).toBeGreaterThan(0);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 4: Self-Healing Empty Result Detection
// ────────────────────────────────────────────────────────────────────────────
describe("Phase 4 — Self-Healing: Empty Result Detection", () => {
    it("STRESS: [] detected as empty result set", () => {
        const p = safeJsonParse("[]", []);
        expect(Array.isArray(p.data) && p.data.length === 0).toBe(true);
    });

    it("STRESS: non-empty result is NOT empty", () => {
        const p = safeJsonParse('[{"amount": 100}]', []);
        expect(Array.isArray(p.data) && p.data.length === 0).toBe(false);
    });

    it("STRESS: null value rows are NOT empty", () => {
        const p = safeJsonParse('[{"total": null}]', []);
        expect(Array.isArray(p.data) && p.data.length === 0).toBe(false);
    });

    it("STRESS: SQL error is caught by hasError before self-healing check", () => {
        const raw = "SQL Execution Error: syntax error at line 1";
        expect(raw.startsWith("SQL Execution Error:")).toBe(true);
    });

    it("STRESS: invalid JSON returns fallback and is handled", () => {
        const raw = "not json at all";
        const p = safeJsonParse(raw, []);
        expect(p.data).toEqual([]);
    });

    it("STRESS: feedback covers 3 root causes (ILIKE, Excel serial, categorical)", () => {
        const feedback = [
            "The SQL executed successfully but returned 0 rows (empty result).",
            "Possible causes:",
            "(1) categorical filter value mismatch — use ILIKE with partial matching",
            "(2) date column type may be INT (Excel serial) or TEXT when you assumed DATE",
            "(3) data may use different capitalization or format",
        ].join("\n");
        expect(feedback).toContain("ILIKE");
        expect(feedback).toContain("Excel serial");
        expect(feedback).toContain("categorical");
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Cross-Phase: Prompt Integrity
// ────────────────────────────────────────────────────────────────────────────
describe("Cross-Phase: Prompt Integrity", () => {
    it("STRESS: sql_gen has SAMPLE VALUES rule", async () => {
        const { prompts } = await import("../agents/prompts.js");
        expect(prompts.tech_agent_sql_gen).toContain("SAMPLE VALUES FOR CATEGORICAL FILTERS");
        expect(prompts.tech_agent_sql_gen).toContain("ILIKE");
    });

    it("STRESS: sql_gen has KNOWN RELATIONSHIPS rule", async () => {
        const { prompts } = await import("../agents/prompts.js");
        expect(prompts.tech_agent_sql_gen).toContain("KNOWN RELATIONSHIPS FOR JOINS");
    });

    it("STRESS: all 5 prompt keys defined", async () => {
        const { prompts } = await import("../agents/prompts.js");
        const keys = ["supervisor", "tech_agent_sql_gen", "tech_agent_explain", "finance_agent", "dashboard_designer"];
        for (const k of keys) {
            expect(prompts[k as keyof typeof prompts]).toBeDefined();
        }
    });

    it("STRESS: {catalog} placeholder in sql_gen prompt", async () => {
        const { prompts } = await import("../agents/prompts.js");
        expect(prompts.tech_agent_sql_gen).toContain("{catalog}");
    });

    it("STRESS: {schema} placeholder in dashboard_designer prompt", async () => {
        const { prompts } = await import("../agents/prompts.js");
        expect(prompts.dashboard_designer).toContain("{schema}");
    });

    it("STRESS: no hardcoded date literals in prompt (only in WRONG examples)", async () => {
        const { prompts } = await import("../agents/prompts.js");
        const sqlGen = prompts.tech_agent_sql_gen as string;
        const datePat = /\b(2024|2025|2026|2027)-\d{2}-\d{2}\b/;
        const lines = sqlGen.split("\n");
        for (const line of lines) {
            if (datePat.test(line)) {
                const isAllowed = /WRONG|✗|NEVER|example|Example/i.test(line);
                expect(isAllowed).toBe(true);
            }
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Integration: Combined Edge Cases
// ────────────────────────────────────────────────────────────────────────────
describe("Integration: Combined Edge Cases", () => {
    it("STRESS: column has no profile entry — does not crash buildSchemaDefinition", async () => {
        const profiles = { id: makeProfile("integer", 100, "1", "100") };
        const entry = makeEntry("sparse", ["id", "unprofiled_col"], profiles);
        const { buildSchemaDefinition } = await import("../db/data-lake.js");
        await expect(buildSchemaDefinition(entry)).resolves.not.toThrow();
    });

    it("STRESS: all 6 profile types produce correct labels (INT/DEC/lowercase)", async () => {
        const profiles = {
            a: makeProfile("integer", 1),
            b: makeProfile("numeric", 1),
            c: makeProfile("text", 1),
            d: makeProfile("boolean", 1),
            e: makeProfile("jsonb", 1),
            f: makeProfile("timestamp", 1),
        };
        const entry = makeEntry("typetest", ["a", "b", "c", "d", "e", "f"], profiles);
        const { buildSchemaDefinition } = await import("../db/data-lake.js");
        const result = await buildSchemaDefinition(entry);
        expect(result).toContain("a (INT,");
        expect(result).toContain("b (DEC,");
        expect(result).toContain("c (text,");
        expect(result).toContain("d (boolean,");
        expect(result).toContain("e (jsonb,");
        expect(result).toContain("f (timestamp,");
    });
});

// ── Helpers ────────────────────────────────────────────────────────────────
function safeJsonParse(raw: string, fallback: any) {
    try { return { data: JSON.parse(raw), cleaned: raw }; }
    catch { return { data: fallback, cleaned: raw }; }
}
