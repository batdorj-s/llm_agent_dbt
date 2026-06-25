import { describe, it, expect } from "vitest";
import {
    detectDateColumn,
    extractProfileFromSchemaDef,
    findDateColumnWithCast,
} from "../agents/dateColumnHelper.js";

function simulateOldFindDateColumn(columns: string[], columnTypes?: Record<string, string>): string | null {
    const datePatterns = [/date/i, /time/i, /month/i, /year/i, /timestamp/i, /day/i, /order_date/i, /invoice/i];
    for (const col of columns) {
        const type = columnTypes?.[col];
        if (type === "DATE" || type === "TIMESTAMP") return col;
        for (const pat of datePatterns) {
            if (pat.test(col)) return col;
        }
    }
    return null;
}

function simulateOldGetDateCast(col: string, colType: string): string {
    if (colType === "INT") {
        return `'1899-12-30'::date + "${col}"::integer`;
    }
    return `CAST("${col}" AS DATE)`;
}

describe("detectDateColumn — synthetic column tests", () => {
    it("ISO TEXT date: CAST works fine", () => {
        const result = detectDateColumn("order_date", "text", {
            sampleValues: ["2024-01-15", "2024-02-20"],
        });
        expect(result).not.toBeNull();
        expect(result!.sqlCast).toBe('CAST("order_date" AS DATE)');
        expect(result!.detectedAs).toBe("text-iso");
    });

    it("Non-ISO TEXT date (US format): old CAST fails, TO_DATE needed", () => {
        const result = detectDateColumn("sale_date", "text", {
            sampleValues: ["01/15/2024", "03/22/2024"],
        });
        expect(result).not.toBeNull();
        expect(result!.sqlCast).toBe('TO_DATE("sale_date", \'MM/DD/YYYY\')');
        expect(result!.detectedAs).toBe("text-us");
    });

    it("Non-ISO TEXT date (EU format): old CAST fails, TO_DATE needed", () => {
        const result = detectDateColumn("datum", "text", {
            sampleValues: ["15.01.2024", "22.03.2024"],
        });
        expect(result).not.toBeNull();
        expect(result!.sqlCast).toBe('TO_DATE("datum", \'DD.MM.YYYY\')');
        expect(result!.detectedAs).toBe("text-eu");
    });

    it("INT year column: old code gives wrong date, should use MAKE_DATE", () => {
        const result = detectDateColumn("year_col", "INT", {
            min: "2019", max: "2024",
        });
        expect(result).not.toBeNull();
        expect(result!.sqlCast).toBe('MAKE_DATE("year_col"::integer, 1, 1)');
        expect(result!.detectedAs).toBe("int-year");
    });

    it("INT serial column: Excel serial cast is correct", () => {
        const result = detectDateColumn("date_serial", "INT", {
            min: "40000", max: "45000",
        });
        expect(result).not.toBeNull();
        expect(result!.sqlCast).toBe('\'1899-12-30\'::date + "date_serial"::integer');
        expect(result!.detectedAs).toBe("int-serial");
    });

    it("INT ID column (small range): old code gives nonsense date, should reject", () => {
        const result = detectDateColumn("id_col", "INT", {
            min: "1", max: "100",
        });
        expect(result).toBeNull();
    });

    it("INT negative values: should reject", () => {
        const result = detectDateColumn("neg_col", "INT", {
            min: "-500", max: "-1",
        });
        expect(result).toBeNull();
    });

    it("INT unique values (range > 100 but outside known ranges): should reject", () => {
        const result = detectDateColumn("code_col", "INT", {
            min: "10000", max: "15000",
        });
        expect(result).toBeNull();
    });

    it("Native DATE type: simple CAST", () => {
        const result = detectDateColumn("created_date", "date");
        expect(result).not.toBeNull();
        expect(result!.sqlCast).toBe('CAST("created_date" AS DATE)');
        expect(result!.detectedAs).toBe("native");
    });

    it("Native TIMESTAMP type: simple CAST", () => {
        const result = detectDateColumn("created_at", "timestamp");
        expect(result).not.toBeNull();
        expect(result!.sqlCast).toBe('CAST("created_at" AS DATE)');
        expect(result!.detectedAs).toBe("native");
    });

    it("Name heuristic fallback: date keyword in name", () => {
        const result = detectDateColumn("transaction_date", "unknown");
        expect(result).not.toBeNull();
        expect(result!.sqlCast).toBe('CAST("transaction_date" AS DATE)');
        expect(result!.detectedAs).toBe("name-heuristic");
    });

    it("Non-date column: should be null", () => {
        const result = detectDateColumn("customer_name", "text", {
            sampleValues: ["Alice", "Bob"],
        });
        expect(result).toBeNull();
    });

    it("Non-date numeric: should be null", () => {
        const result = detectDateColumn("amount", "DEC", {
            min: "0", max: "10000",
        });
        expect(result).toBeNull();
    });

    it("INT gap value 5000 (above year, below serial): should reject", () => {
        const result = detectDateColumn("customer_id", "INT", {
            min: "5000", max: "5000",
        });
        expect(result).toBeNull();
    });

    it("INT gap value 15000 (above year, below serial): should reject", () => {
        const result = detectDateColumn("order_code", "INT", {
            min: "15000", max: "15000",
        });
        expect(result).toBeNull();
    });

    it("INT gap range 101-200 (above ID, below year): should reject", () => {
        const result = detectDateColumn("dept_code", "INT", {
            min: "101", max: "200",
        });
        expect(result).toBeNull();
    });

    it("INT gap range 2101-2200 (above year, below serial): should reject", () => {
        const result = detectDateColumn("fiscal_code", "INT", {
            min: "2101", max: "2200",
        });
        expect(result).toBeNull();
    });

    it("INT year lower boundary inclusive: 1900 is year", () => {
        const result = detectDateColumn("year_col", "INT", {
            min: "1900", max: "1900",
        });
        expect(result).not.toBeNull();
        expect(result!.detectedAs).toBe("int-year");
    });

    it("INT just below year: 1899 is not year (rejected as ID range)", () => {
        const result = detectDateColumn("year_col", "INT", {
            min: "1899", max: "1899",
        });
        expect(result).toBeNull();
    });

    it("INT year upper boundary inclusive: 2100 is year", () => {
        const result = detectDateColumn("year_col", "INT", {
            min: "2000", max: "2100",
        });
        expect(result).not.toBeNull();
        expect(result!.detectedAs).toBe("int-year");
    });

    it("INT just above year: 2101 is not year (rejected as gap)", () => {
        const result = detectDateColumn("year_col", "INT", {
            min: "2000", max: "2101",
        });
        expect(result).toBeNull();
    });

    it("INT serial lower boundary inclusive: 20000 is serial", () => {
        const result = detectDateColumn("serial_col", "INT", {
            min: "20000", max: "20000",
        });
        expect(result).not.toBeNull();
        expect(result!.detectedAs).toBe("int-serial");
    });

    it("INT just below serial: 19999 is not serial (rejected as ID range)", () => {
        const result = detectDateColumn("serial_col", "INT", {
            min: "19999", max: "19999",
        });
        expect(result).toBeNull();
    });

    it("INT serial upper boundary inclusive: 50000 is serial", () => {
        const result = detectDateColumn("serial_col", "INT", {
            min: "40000", max: "50000",
        });
        expect(result).not.toBeNull();
        expect(result!.detectedAs).toBe("int-serial");
    });

    it("INT just above serial: 50001 is not serial (rejected as gap)", () => {
        const result = detectDateColumn("serial_col", "INT", {
            min: "40000", max: "50001",
        });
        expect(result).toBeNull();
    });

    it("TEXT mixed format samples (ISO + US): should reject", () => {
        const result = detectDateColumn("mixed_date", "text", {
            sampleValues: ["2024-01-15", "01/15/2024"],
        });
        expect(result).toBeNull();
    });

    it("TEXT mixed format with majority ISO: should reject (inconsistency)", () => {
        const result = detectDateColumn("mixed_date", "text", {
            sampleValues: ["2024-01-15", "2024-02-20", "03/22/2024"],
        });
        expect(result).toBeNull();
    });

    it("TEXT all samples ISO: accepts with consistent ISO format", () => {
        const result = detectDateColumn("order_date", "text", {
            sampleValues: ["2024-01-15", "2024-02-20", "2024-03-25"],
        });
        expect(result).not.toBeNull();
        expect(result!.detectedAs).toBe("text-iso");
    });

    it("Name heuristic: 'validated' should NOT match (false-positive prevention)", () => {
        const result = detectDateColumn("validated", "unknown");
        expect(result).toBeNull();
    });

    it("Name heuristic: 'monthly_sales' should NOT match (false-positive prevention)", () => {
        const result = detectDateColumn("monthly_sales", "unknown");
        expect(result).toBeNull();
    });

    it("Name heuristic: 'updated_at' should match (_at suffix)", () => {
        const result = detectDateColumn("updated_at", "unknown");
        expect(result).not.toBeNull();
        expect(result!.detectedAs).toBe("name-heuristic");
    });

    it("Name heuristic: 'created_date' should match (_date suffix)", () => {
        const result = detectDateColumn("created_date", "unknown");
        expect(result).not.toBeNull();
        expect(result!.detectedAs).toBe("name-heuristic");
    });

    it("Name heuristic: 'inserted_timestamp' should match (_timestamp suffix)", () => {
        const result = detectDateColumn("inserted_timestamp", "unknown");
        expect(result).not.toBeNull();
        expect(result!.detectedAs).toBe("name-heuristic");
    });

    it("Name heuristic: 'start_time' should match (_time suffix)", () => {
        const result = detectDateColumn("start_time", "unknown");
        expect(result).not.toBeNull();
        expect(result!.detectedAs).toBe("name-heuristic");
    });

    it("Name heuristic: 'invoice' should match", () => {
        const result = detectDateColumn("invoice", "unknown");
        expect(result).not.toBeNull();
        expect(result!.detectedAs).toBe("name-heuristic");
    });

    it("Name heuristic: 'today' should NOT match (false-positive prevention)", () => {
        const result = detectDateColumn("today", "unknown");
        expect(result).toBeNull();
    });

    it("Name heuristic: 'birthday' should NOT match (false-positive prevention)", () => {
        const result = detectDateColumn("birthday", "unknown");
        expect(result).toBeNull();
    });
});

describe("extractProfileFromSchemaDef", () => {
    const schemaDef = [
        'Table: test_table',
        'Description: N/A',
        'Total distinct values per column:',
        '- id (INT, 100 distinct [1..100])',
        '  Sample values: 1, 2, 3',
        '- date_int (INT, 5 distinct [2019..2024])',
        '  Sample values: 2019, 2020, 2021',
        '- order_date (text, 10 distinct)',
        '  Sample values: 2024-01-15, 2024-02-20',
        '- sale_date (text, 8 distinct)',
        '  Sample values: 01/15/2024, 03/22/2024',
    ].join("\n");

    it("parses INT column with range", () => {
        const profile = extractProfileFromSchemaDef(schemaDef, "date_int");
        expect(profile).not.toBeNull();
        expect(profile!.min).toBe("2019");
        expect(profile!.max).toBe("2024");
        expect(profile!.sampleValues).toEqual(["2019", "2020", "2021"]);
    });

    it("parses INT column with range but no range brackets", () => {
        const profile = extractProfileFromSchemaDef(schemaDef, "id");
        expect(profile).not.toBeNull();
        expect(profile!.min).toBe("1");
        expect(profile!.max).toBe("100");
        expect(profile!.sampleValues).toEqual(["1", "2", "3"]);
    });

    it("parses TEXT column with samples", () => {
        const profile = extractProfileFromSchemaDef(schemaDef, "order_date");
        expect(profile).not.toBeNull();
        expect(profile!.min).toBeUndefined();
        expect(profile!.max).toBeUndefined();
        expect(profile!.sampleValues).toEqual(["2024-01-15", "2024-02-20"]);
    });

    it("returns null for unknown column", () => {
        const profile = extractProfileFromSchemaDef(schemaDef, "nonexistent");
        expect(profile).toBeNull();
    });
});

describe("findDateColumnWithCast", () => {
    it("finds date column and returns correct cast", () => {
        const columns = ["id", "name", "order_date", "amount"];
        const columnTypes = { id: "INT", name: "text", order_date: "text", amount: "DEC" };
        const schemaDef = [
            'Table: test',
            'Description: N/A',
            'Total distinct values per column:',
            '- id (INT, 100 distinct [1..100])',
            '- name (text, 50 distinct)',
            '- order_date (text, 10 distinct)',
            '  Sample values: 2024-01-15, 2024-02-20',
            '- amount (DEC, 100 distinct [0..10000])',
        ].join("\n");
        const result = findDateColumnWithCast(columns, columnTypes, schemaDef);
        expect(result).not.toBeNull();
        expect(result!.column).toBe("order_date");
        expect(result!.sqlCast).toBe('CAST("order_date" AS DATE)');
    });

    it("returns null when no date column", () => {
        const columns = ["id", "name", "amount"];
        const columnTypes = { id: "INT", name: "text", amount: "DEC" };
        const schemaDef = [
            'Table: test',
            'Description: N/A',
            'Total distinct values per column:',
            '- id (INT, 100 distinct [1..100])',
            '- name (text, 50 distinct)',
            '- amount (DEC, 100 distinct [0..10000])',
        ].join("\n");
        const result = findDateColumnWithCast(columns, columnTypes, schemaDef);
        expect(result).toBeNull();
    });

    it("finds date column with native type", () => {
        const columns = ["id", "created_date", "revenue"];
        const columnTypes = { id: "INT", created_date: "date", revenue: "DEC" };
        const schemaDef = [
            'Table: test',
            'Description: N/A',
            'Total distinct values per column:',
            '- id (INT, 100 distinct [1..100])',
            '- created_date (date, 50 distinct)',
            '- revenue (DEC, 50 distinct [0..50000])',
        ].join("\n");
        const result = findDateColumnWithCast(columns, columnTypes, schemaDef);
        expect(result).not.toBeNull();
        expect(result!.column).toBe("created_date");
        expect(result!.sqlCast).toBe('CAST("created_date" AS DATE)');
    });
});

describe("Current buggy behavior (demonstration)", () => {
    it("Bug #1: findDateColumn uppercase type check misses lowercase 'date'/'timestamp'", () => {
        const result = simulateOldFindDateColumn(
            ["id", "created", "amount"],
            { id: "INT", created: "date", amount: "DEC" },
        );
        const tsResult = simulateOldFindDateColumn(
            ["id", "ts", "amount"],
            { id: "INT", ts: "timestamp", amount: "DEC" },
        );
        expect(result).toBeNull();
        expect(tsResult).toBeNull();
    });

    it("Bug #2: INT year column gets wrong Excel serial cast", () => {
        const cast = simulateOldGetDateCast("year_col", "INT");
        expect(cast).toBe('\'1899-12-30\'::date + "year_col"::integer');
    });

    it("Bug #3: INT ID column gets nonsense date", () => {
        const cast = simulateOldGetDateCast("id_col", "INT");
        expect(cast).toBe('\'1899-12-30\'::date + "id_col"::integer');
    });

    it("Bug #4: Non-ISO text gets same CAST as ISO (fails in PG)", () => {
        const cast = simulateOldGetDateCast("sale_date", "text");
        expect(cast).toBe('CAST("sale_date" AS DATE)');
    });
});
