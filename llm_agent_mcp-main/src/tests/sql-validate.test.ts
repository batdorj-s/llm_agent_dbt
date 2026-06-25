import { describe, it, expect } from "vitest";
import { assertSelectOnly, validateSqlColumnsAgainstCatalog, type DataLakeCatalogEntry } from "../db/data-lake.js";

describe("SQL Query Validation — structural allowlist", () => {
    it("should allow simple SELECT", () => {
        expect(() => assertSelectOnly("SELECT * FROM users")).not.toThrow();
    });

    it("should allow SELECT with WHERE", () => {
        expect(() => assertSelectOnly("SELECT id, name FROM users WHERE status = 'active'")).not.toThrow();
    });

    it("should allow SELECT with JOIN", () => {
        expect(() => assertSelectOnly("SELECT u.id, o.total FROM users u JOIN orders o ON u.id = o.user_id")).not.toThrow();
    });

    it("should allow WITH (CTE) + SELECT", () => {
        expect(() => assertSelectOnly("WITH cte AS (SELECT id FROM users) SELECT * FROM cte")).not.toThrow();
    });

    it("should reject DROP TABLE", () => {
        expect(() => assertSelectOnly("DROP TABLE users")).toThrow(/Only SELECT/);
    });

    it("should reject DELETE", () => {
        expect(() => assertSelectOnly("DELETE FROM users WHERE id=1")).toThrow(/Only SELECT/);
    });

    it("should reject UPDATE", () => {
        expect(() => assertSelectOnly("UPDATE users SET name='test'")).toThrow(/Only SELECT/);
    });

    it("should reject INSERT", () => {
        expect(() => assertSelectOnly("INSERT INTO users VALUES (1)")).toThrow(/Only SELECT/);
    });

    it("should reject ALTER TABLE", () => {
        expect(() => assertSelectOnly("ALTER TABLE users ADD COLUMN x INT")).toThrow(/Only SELECT/);
    });

    it("should reject CREATE TABLE", () => {
        expect(() => assertSelectOnly("CREATE TABLE hack (id INT)")).toThrow(/Only SELECT/);
    });

    it("should reject multi-statement queries (SELECT; DROP)", () => {
        expect(() => assertSelectOnly("SELECT 1; DROP TABLE users")).toThrow(/Expected exactly 1/);
    });

    it("should reject COPY (by failing to parse)", () => {
        expect(() => assertSelectOnly("COPY users TO '/tmp/passwords'")).toThrow(/Only SELECT/);
    });
});

describe("SELECT query detection", () => {
    function isSelectQuery(query: string): boolean {
        const normalized = query.trim().toUpperCase();
        return /^\s*SELECT\b/i.test(normalized) ||
            (/^\s*WITH\b/i.test(normalized) && /SELECT\b/i.test(normalized.replace(/^\s*WITH[\s\S]*?SELECT\b/i, "")));
    }

    it("should detect simple SELECT", () => {
        expect(isSelectQuery("SELECT * FROM users")).toBe(true);
    });

    it("should detect WITH ... SELECT", () => {
        expect(isSelectQuery("WITH cte AS (SELECT id FROM users) SELECT * FROM cte")).toBe(true);
    });

    it("should reject plain DROP", () => {
        expect(isSelectQuery("DROP TABLE users")).toBe(false);
    });

    it("should detect SELECT with leading whitespace", () => {
        expect(isSelectQuery("  SELECT id FROM users")).toBe(true);
    });
});

describe("CTE name resolution — #5 AST-based getCteNames", () => {
    function entry(tableName: string, extraColumns?: string[]): DataLakeCatalogEntry {
        return {
            id: 1,
            table_name: tableName,
            created_by: "test",
            owner_id: "test",
            visibility: "shared",
            created_at: "2026-01-01",
            columns_info: JSON.stringify(extraColumns ?? ["id", "name", "secret"]),
            description: null,
        };
    }

    it("WITH cte + SELECT: CTE name not looked up as real table", () => {
        const catalog = [entry("users")];
        expect(() => validateSqlColumnsAgainstCatalog(
            "WITH cte AS (SELECT id FROM users) SELECT * FROM cte",
            catalog,
        )).not.toThrow();
    });

    it("WITH cte + SELECT with column ref: outer query references CTE, not underlying table", () => {
        const catalog = [entry("users")];
        expect(() => validateSqlColumnsAgainstCatalog(
            "WITH cte AS (SELECT id, name FROM users) SELECT id FROM cte",
            catalog,
        )).not.toThrow();
    });

    it("SELECT without CTE: real table name still validated", () => {
        const catalog = [entry("users")];
        expect(() => validateSqlColumnsAgainstCatalog(
            "SELECT * FROM users",
            catalog,
        )).not.toThrow();
    });

    it("SELECT referencing non-existent table throws", () => {
        const catalog = [entry("users")];
        expect(() => validateSqlColumnsAgainstCatalog(
            "SELECT * FROM nonexistent",
            catalog,
        )).toThrow(/Хүснэгт/);
    });

    it("multiple CTEs: all names extracted, none consulted as real tables", () => {
        const catalog = [entry("users")];
        expect(() => validateSqlColumnsAgainstCatalog(
            "WITH a AS (SELECT id FROM users), b AS (SELECT name FROM users) SELECT a.id, b.name FROM a JOIN b ON a.id = b.id",
            catalog,
        )).not.toThrow();
    });

    it("CTE name shadowing real table: CTE name takes precedence, no lookup for shadowed table", () => {
        const catalog = [entry("users", ["id", "secret"]), entry("cte", ["x", "y"])];
        // Even though "cte" exists as a real table in catalog, the CTE definition
        // takes precedence, so it should not be looked up as a real table
        expect(() => validateSqlColumnsAgainstCatalog(
            "WITH cte AS (SELECT id FROM users) SELECT * FROM cte",
            catalog,
        )).not.toThrow();
    });
});

describe("SQL tenant isolation validation", () => {
    function entry(tableName: string, ownerId: string): DataLakeCatalogEntry {
        return {
            id: 1,
            table_name: tableName,
            created_by: ownerId,
            owner_id: ownerId,
            visibility: "private",
            created_at: "2026-01-01",
            columns_info: JSON.stringify(["id", "secret"]),
            description: "tenant test",
        };
    }

    it("rejects SQL that references a table outside the caller-scoped catalog", () => {
        const userACatalog = [entry("tenant_a_private", "tenant_a")];

        expect(() => validateSqlColumnsAgainstCatalog(
            `SELECT secret FROM "tenant_b_private"`,
            userACatalog
        )).toThrow(/Хүснэгт 'tenant_b_private' байхгүй/);
    });

    it("allows SQL that references a table inside the caller-scoped catalog", () => {
        const userACatalog = [entry("tenant_a_private", "tenant_a")];

        expect(() => validateSqlColumnsAgainstCatalog(
            `SELECT secret FROM "tenant_a_private"`,
            userACatalog
        )).not.toThrow();
    });
});
