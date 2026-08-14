import { describe, it, expect } from "vitest";
import {
  generateRuleBasedProfile,
  detectDataQualityIssues,
  generateQualityReport,
} from "../agents/dataProfiler.js";

const sampleRows = [
  { amount: 100, category: "food", order_id: "A1", note: "" },
  { amount: 200, category: "food", order_id: "A1", note: null },
  { amount: 300, category: "transport", order_id: "B2", note: "x" },
  { amount: "400", category: "transport", order_id: "C3", note: "y" },
];

describe("generateRuleBasedProfile", () => {
  it("detects numeric columns from mixed number/string values", () => {
    const result = generateRuleBasedProfile("sales", ["amount", "category"], sampleRows);
    expect(result.numericStats).toHaveLength(1);
    expect(result.numericStats[0].column).toBe("amount");
    expect(result.numericStats[0].stats.min).toBe(100);
    expect(result.numericStats[0].stats.max).toBe(400);
    expect(result.categoricalStats).toHaveLength(1);
    expect(result.categoricalStats[0].column).toBe("category");
    expect(result.categoricalStats[0].distinctCount).toBe(2);
    expect(result.categoricalStats[0].topValues[0]).toBe("food");
  });

  it("treats missing values as categorical bucket NULL", () => {
    const result = generateRuleBasedProfile("t", ["note"], sampleRows);
    expect(result.categoricalStats[0].column).toBe("note");
    expect(result.categoricalStats[0].distinctCount).toBe(4);
    expect(result.categoricalStats[0].topValues).toContain("NULL");
  });

  it("builds a summary with table name and column count", () => {
    const result = generateRuleBasedProfile("sales", ["amount", "category"], sampleRows);
    expect(result.summary).toContain("sales");
    expect(result.summary).toContain("**Баганууд**: 2");
    expect(result.summary).toContain("Тоон");
  });

  it("handles empty sample data without crashing", () => {
    const result = generateRuleBasedProfile("empty", ["a", "b"], []);
    expect(result.numericStats).toHaveLength(0);
    expect(result.categoricalStats).toHaveLength(2);
  });
});

describe("detectDataQualityIssues", () => {
  it("flags high-severity when more than half values are missing", () => {
    const rows = [{ col: null }, { col: null }, { col: 1 }];
    const issues = detectDataQualityIssues(rows, ["col"]);
    expect(issues.some(i => i.column === "col" && i.severity === "high")).toBe(true);
  });

  it("flags medium-severity between 20% and 50% missing", () => {
    const rows = [{ col: null }, { col: null }, { col: 2 }, { col: 3 }, { col: 4 }];
    const issues = detectDataQualityIssues(rows, ["col"]);
    expect(issues.some(i => i.column === "col" && i.severity === "medium")).toBe(true);
  });

  it("flags duplicate values in id-like columns", () => {
    const rows = [{ id: "x" }, { id: "x" }, { id: "y" }];
    const issues = detectDataQualityIssues(rows, ["id"]);
    expect(issues.some(i => i.issue.includes("давхардал"))).toBe(true);
  });

  it("returns no issues for clean data", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(detectDataQualityIssues(rows, ["id"])).toHaveLength(0);
  });
});

describe("generateQualityReport", () => {
  it("returns a success message when no issues exist", () => {
    const report = generateQualityReport("sales", []);
    expect(report).toContain("sales");
    expect(report).toContain("асуудал олдсонгүй");
  });

  it("summarizes issues by severity and lists each one", () => {
    const issues = [
      { column: "amount", issue: "50% хоосон утга", severity: "high" as const },
      { column: "id", issue: "2 давхардалтай утга", severity: "medium" as const },
      { column: "note", issue: "12% хоосон утга", severity: "low" as const },
    ];
    const report = generateQualityReport("sales", issues);
    expect(report).toContain("sales");
    expect(report).toContain("Дөндөр түвшин: 1");
    expect(report).toContain("Дунд түвшин: 1");
    expect(report).toContain("Бага түвшин: 1");
    expect(report).toContain("amount");
    expect(report).toContain("note");
  });
});
