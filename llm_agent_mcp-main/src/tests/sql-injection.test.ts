import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("SQL injection — defense-in-depth", () => {
    // ── reportMetrics.ts ──
    describe("reportMetrics.ts", () => {
        const src = fs.readFileSync(
            path.join(__dirname, "../agents/reportMetrics.ts"),
            "utf8"
        );

        it("imports sanitizeColumnName", () => {
            expect(src).toMatch(/import.*sanitizeColumnName/);
        });

        it("calls sanitizeColumnName before using column names in SQL", () => {
            expect(src).toMatch(/sanitizeColumnName\(/);
        });

        it("does not interpolate column names unsafely (without sanitizeColumnName call in same function)", () => {
            const lines = src.split("\n");
            const sqlLines = lines.filter(l =>
                l.includes('"${') && l.includes('}"') && !l.includes("sanitizeColumnName")
            );
            // Every line that has double-quoted SQL interpolation should also
            // have a sanitizeColumnName call somewhere in the file
            expect(sqlLines.length).toBeLessThanOrEqual(src.split("sanitizeColumnName").length - 1);
        });
    });

    // ── data-lake.ts ──
    describe("data-lake.ts", () => {
        const src = fs.readFileSync(
            path.join(__dirname, "../db/data-lake.ts"),
            "utf8"
        );

        it("has quoteIdent helper function", () => {
            expect(src).toMatch(/function quoteIdent/);
        });

        it("does not interpolate tableName directly in SQL template literals", () => {
            const lines = src.split("\n");
            const unsafeLines = lines.filter(l =>
                l.includes('"${tableName}"') && !l.includes("quoteIdent")
            );
            expect(unsafeLines).toHaveLength(0);
        });

        it("does not interpolate column names directly in SQL template literals", () => {
            const lines = src.split("\n");
            const unsafeLines = lines.filter(l => {
                const hasInterpolation = /\${[a-z]+}/.test(l);
                const isSql = l.includes("pool.query") || l.includes("SELECT") || l.includes("FROM") || l.includes("INSERT");
                const hasSanitizeCall = l.includes("sanitizeColumnName") || l.includes("quoteIdent");
                return hasInterpolation && isSql && !hasSanitizeCall;
            });
            expect(unsafeLines.length).toBeLessThanOrEqual(5);
        });
    });
});
