import { describe, it, expect } from "vitest";

// Test date-awareness logic from data-scientist.ts in isolation
describe("Date Column Type Detection", () => {
    type ColumnTypes = Record<string, string>;

    function findDateColumn(columns: string[], colTypes?: ColumnTypes): string | null {
        const dateKeywords = ["date", "огноо", "сар", "month", "жыл", "year", "dag", "time", "timestamp", "datetime", "θar", "on"];
        for (const col of columns) {
            const lower = col.toLowerCase();
            if (dateKeywords.some(k => lower.includes(k))) return col;
        }
        return null;
    }

    function getDateCast(col: string, colType: string): string {
        if (colType === "integer" || colType === "int4" || colType === "int8") {
            return `'1899-12-30'::date + "${col}"::integer`;
        }
        if (colType === "text" || colType === "varchar" || colType === "character varying") {
            return `TO_DATE("${col}", 'YYYY-MM-DD')`;
        }
        return `"${col}"::date`;
    }

    it("should find date column", () => {
        expect(findDateColumn(["id", "name", "date", "amount"])).toBe("date");
    });

    it("should find month column", () => {
        expect(findDateColumn(["id", "month", "revenue"])).toBe("month");
    });

    it("should find Mongolian огноо", () => {
        expect(findDateColumn(["id", "огноо", "борлуулалт"])).toBe("огноо");
    });

    it("should return null when no date column exists", () => {
        expect(findDateColumn(["id", "name", "amount"])).toBeNull();
    });

    it("should return date cast for integer column", () => {
        const cast = getDateCast("date", "integer");
        expect(cast).toBe(`'1899-12-30'::date + "date"::integer`);
    });

    it("should return date cast for text column", () => {
        const cast = getDateCast("date", "text");
        expect(cast).toBe(`TO_DATE("date", 'YYYY-MM-DD')`);
    });

    it("should return direct cast for date column", () => {
        const cast = getDateCast("date", "date");
        expect(cast).toBe(`"date"::date`);
    });

    it("should return direct cast for timestamp column", () => {
        const cast = getDateCast("created_at", "timestamp");
        expect(cast).toBe(`"created_at"::date`);
    });
});

describe("parseColumnTypes", () => {
    function parseColumnTypes(schemaStr: string): Record<string, string> {
        const types: Record<string, string> = {};
        const lines = schemaStr.split("\n");
        for (const line of lines) {
            const match = line.match(/^\s*(\w+)\s+(INTEGER|INT4|INT8|BIGINT|TEXT|VARCHAR|DATE|TIMESTAMP|FLOAT|NUMERIC|BOOLEAN)/i);
            if (match) {
                types[match[1].toLowerCase()] = match[2].toLowerCase();
            }
        }
        return types;
    }

    it("should parse simple schema", () => {
        const schema = `id INTEGER\nname TEXT\ndate INTEGER\namount NUMERIC`;
        const result = parseColumnTypes(schema);
        expect(result).toEqual({ id: "integer", name: "text", date: "integer", amount: "numeric" });
    });

    it("should return empty for empty schema", () => {
        expect(parseColumnTypes("")).toEqual({});
    });
});
