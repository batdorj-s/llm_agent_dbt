import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateVisualTag } from "../agents/sqlGeneration.js";

const makeData = (rows: Record<string, unknown>[]) => JSON.stringify(rows);

describe("generateVisualTag dynamic year range", () => {
    beforeAll(() => {
        vi.useFakeTimers();
    });
    afterAll(() => {
        vi.useRealTimers();
    });

    it("detects future year as time series when current year is past hardcoded range", () => {
        vi.setSystemTime(new Date("2030-06-15"));

        const data = makeData([
            { label: "2030-01", value: 100 },
            { label: "2030-02", value: 150 },
        ]);

        const result = generateVisualTag(data);
        expect(result).toContain("<visual>");
        expect(result).toContain('"type":"line"');
    });

    it("detects current year labels as time series", () => {
        vi.setSystemTime(new Date("2026-06-15"));

        const data = makeData([
            { label: "Jan 2026", value: 100 },
            { label: "Feb 2026", value: 150 },
        ]);

        const result = generateVisualTag(data);
        expect(result).toContain("<visual>");
        expect(result).toContain('"type":"line"');
    });

    it("returns empty string for single-row data", () => {
        const data = makeData([{ label: "2026-01", value: 100 }]);
        expect(generateVisualTag(data)).toBe("");
    });

    it("returns empty string for invalid JSON", () => {
        expect(generateVisualTag("not json")).toBe("");
    });

    it("generates bar chart for non-time series categories (7+ items)", () => {
        vi.setSystemTime(new Date("2026-06-15"));

        const data = makeData([
            { label: "Улаанбаатар", value: 500 },
            { label: "Дархан", value: 300 },
            { label: "Эрдэнэт", value: 200 },
            { label: "Ховд", value: 150 },
            { label: "Өвөрхангай", value: 120 },
            { label: "Сэлэнгэ", value: 110 },
            { label: "Төв", value: 100 },
        ]);

        const result = generateVisualTag(data);
        expect(result).toContain("<visual>");
        expect(result).toContain('"type":"bar"');
    });

    it("generates pie chart for small non-time series data (<=6 items)", () => {
        vi.setSystemTime(new Date("2026-06-15"));

        const data = makeData([
            { label: "А", value: 50 },
            { label: "Б", value: 30 },
            { label: "В", value: 20 },
        ]);

        const result = generateVisualTag(data);
        expect(result).toContain("<visual>");
        expect(result).toContain('"type":"pie"');
    });

    it("generates combo chart for time series with 2nd metric", () => {
        vi.setSystemTime(new Date("2026-06-15"));

        const data = makeData([
            { label: "Jan 2026", value: 100, profit: 20 },
            { label: "Feb 2026", value: 150, profit: 30 },
        ]);

        const result = generateVisualTag(data);
        expect(result).toContain("<visual>");
        expect(result).toContain('"type":"combo"');
        expect(result).toContain('"lineValue"');
    });

    it("generates stacked bar for non-time data with 2nd metric", () => {
        vi.setSystemTime(new Date("2026-06-15"));

        const data = makeData([
            { label: "Бүтээгдэхүүн А", value: 100, profit: 20 },
            { label: "Бүтээгдэхүүн Б", value: 150, profit: 30 },
        ]);

        const result = generateVisualTag(data);
        expect(result).toContain("<visual>");
        expect(result).toContain('"type":"stacked_bar"');
        expect(result).toContain('"series"');
    });

    it("generates line chart for time series with single metric (no second metric)", () => {
        vi.setSystemTime(new Date("2026-06-15"));

        const data = makeData([
            { label: "Jan 2026", sales: 100 },
            { label: "Feb 2026", sales: 150 },
        ]);

        const result = generateVisualTag(data);
        expect(result).toContain("<visual>");
        expect(result).toContain('"type":"line"');
    });
});
