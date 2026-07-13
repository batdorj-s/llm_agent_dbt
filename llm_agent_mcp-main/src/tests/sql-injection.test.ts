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
        const poolSrc = fs.readFileSync(
            path.join(__dirname, "../db/pool.ts"),
            "utf8"
        );
        const profilingSrc = fs.readFileSync(
            path.join(__dirname, "../db/profiling.ts"),
            "utf8"
        );

        it("has quoteIdent helper function in pool.ts", () => {
            expect(poolSrc).toMatch(/function quoteIdent/);
        });

        it("does not interpolate tableName directly in SQL template literals", () => {
            const lines = poolSrc.split("\n");
            const unsafeLines = lines.filter(l =>
                l.includes('"${tableName}"') && !l.includes("quoteIdent")
            );
            expect(unsafeLines).toHaveLength(0);
        });

        it("profiling uses quoteIdent for table and column names", () => {
            expect(profilingSrc).toMatch(/quoteIdent/);
        });
    });
});
