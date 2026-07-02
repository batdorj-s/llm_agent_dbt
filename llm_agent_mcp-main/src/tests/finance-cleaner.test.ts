import { describe, it, expect } from "vitest";
import {
  cleanMNTAmount,
  parseMonthDayDate,
  cleanTransactionRow,
} from "../utils/financeDataCleaner.js";

describe("cleanMNTAmount", () => {
  it("removes ₮ and commas", () => {
    expect(cleanMNTAmount("₮2,000,000")).toBe(2000000);
  });
  it("handles plain number string", () => {
    expect(cleanMNTAmount("28400")).toBe(28400);
  });
  it("handles number with spaces", () => {
    expect(cleanMNTAmount("  500,000 ")).toBe(500000);
  });
  it("returns null for empty string", () => {
    expect(cleanMNTAmount("")).toBeNull();
  });
  it("returns null for non-numeric value", () => {
    expect(cleanMNTAmount("N/A")).toBeNull();
  });
  it("handles decimal amounts", () => {
    expect(cleanMNTAmount("₮1,500.50")).toBe(1500.5);
  });
});

describe("parseMonthDayDate", () => {
  it('parses "5-Jan" to ISO 2026-01-05', () => {
    expect(parseMonthDayDate("5-Jan", 2026)).toBe("2026-01-05");
  });
  it('parses "9-Jan" to ISO 2026-01-09', () => {
    expect(parseMonthDayDate("9-Jan", 2026)).toBe("2026-01-09");
  });
  it("pads single-digit day", () => {
    expect(parseMonthDayDate("1-Mar", 2026)).toBe("2026-03-01");
  });
  it("handles December", () => {
    expect(parseMonthDayDate("31-Dec", 2025)).toBe("2025-12-31");
  });
  it("is case-insensitive for month name", () => {
    expect(parseMonthDayDate("15-JAN", 2026)).toBe("2026-01-15");
  });
  it("returns null for invalid format", () => {
    expect(parseMonthDayDate("invalid")).toBeNull();
  });
  it("returns null for empty string", () => {
    expect(parseMonthDayDate("")).toBeNull();
  });
  it("uses current year as default", () => {
    const result = parseMonthDayDate("5-Jan");
    expect(result).toMatch(/^\d{4}-01-05$/);
  });
  it("returns null for unknown month abbreviation", () => {
    expect(parseMonthDayDate("5-Foo", 2026)).toBeNull();
  });
});

describe("cleanTransactionRow", () => {
  it("cleans a full row with Mongolian column names", () => {
    const row = {
      Өдөр: "5-Jan",
      Харилцагч: "  БАТБИЛЭГ БИЛЭГСАЙХАН  ",
      Дүн: "₮2,000,000",
      Ангилал: "Зарлага",
      "Дэд ангилал": "Оффис",
      Тайлбар: "Оффисын түрээс",
    };
    const result = cleanTransactionRow(row);
    expect(result.огноо).toMatch(/^\d{4}-01-05$/);
    expect(result.харилцагч).toBe("БАТБИЛЭГ БИЛЭГСАЙХАН");
    expect(result.дүн).toBe(2000000);
    expect(result.ангилал).toBe("Зарлага");
    expect(result.дэд_ангилал).toBe("Оффис");
    expect(result.тайлбар).toBe("Оффисын түрээс");
  });

  it("handles missing optional fields gracefully", () => {
    const row = { Өдөр: "9-Jan", Дүн: "500000" };
    const result = cleanTransactionRow(row);
    expect(result.огноо).toMatch(/^\d{4}-01-09$/);
    expect(result.дүн).toBe(500000);
    expect(result.харилцагч).toBe("");
    expect(result.ангилал).toBe("");
  });

  it("returns null дүн for invalid amount", () => {
    const result = cleanTransactionRow({ Дүн: "n/a" });
    expect(result.дүн).toBeNull();
  });
});
