import { describe, it, expect } from "vitest";

// Test the DANGEROUS_SQL regex and query validation patterns in isolation
describe("SQL Query Validation", () => {
    const DANGEROUS_SQL = /\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|REPLACE|TRUNCATE|GRANT|REVOKE)\b/i;

    it("should reject DROP TABLE", () => {
        expect(DANGEROUS_SQL.test("DROP TABLE users")).toBe(true);
    });

    it("should reject DELETE FROM", () => {
        expect(DANGEROUS_SQL.test("DELETE FROM users WHERE id=1")).toBe(true);
    });

    it("should reject UPDATE", () => {
        expect(DANGEROUS_SQL.test("UPDATE users SET name='test'")).toBe(true);
    });

    it("should reject INSERT INTO", () => {
        expect(DANGEROUS_SQL.test("INSERT INTO users VALUES (1)")).toBe(true);
    });

    it("should reject ALTER TABLE", () => {
        expect(DANGEROUS_SQL.test("ALTER TABLE users ADD COLUMN x INT")).toBe(true);
    });

    it("should reject CREATE TABLE", () => {
        expect(DANGEROUS_SQL.test("CREATE TABLE hack (id INT)")).toBe(true);
    });

    it("should allow SELECT", () => {
        expect(DANGEROUS_SQL.test("SELECT * FROM users")).toBe(false);
    });

    it("should allow SELECT with WITH", () => {
        expect(DANGEROUS_SQL.test("WITH cte AS (SELECT * FROM users) SELECT * FROM cte")).toBe(false);
    });

    it("should not false-positive on column names containing dangerous words", () => {
        expect(DANGEROUS_SQL.test("SELECT drop_rate, update_count FROM metrics")).toBe(false);
    });

    it("should not false-positive on aliases containing dangerous words", () => {
        expect(DANGEROUS_SQL.test("SELECT t.name FROM users AS t WHERE t.status = 'active'")).toBe(false);
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
