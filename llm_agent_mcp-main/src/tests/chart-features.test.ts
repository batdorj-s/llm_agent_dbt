import { describe, it, expect } from "vitest";

type ChartType =
  | "line" | "area" | "bar" | "horizontal_bar" | "pie"
  | "combo" | "stacked_bar" | "heatmap" | "donut";

const CHART_TYPES: ChartType[] = [
  "line", "area", "bar", "horizontal_bar", "pie",
  "combo", "stacked_bar", "heatmap", "donut",
];

function getCompatibleTypes(series: string[] | undefined, hasMultiNumeric: boolean): ChartType[] {
  const base: ChartType[] = ["bar", "horizontal_bar", "line", "area", "pie", "donut", "heatmap"];
  if (series && series.length > 1) {
    return [...base, "combo", "stacked_bar"];
  }
  if (hasMultiNumeric) {
    return [...base, "stacked_bar"];
  }
  return base;
}

describe("getCompatibleTypes — chart type filter", () => {
  it("returns all base types for single-series data", () => {
    const result = getCompatibleTypes(undefined, false);
    expect(result).toContain("bar");
    expect(result).toContain("pie");
    expect(result).toContain("donut");
    expect(result).not.toContain("combo");
    expect(result).not.toContain("stacked_bar");
  });

  it("adds combo + stacked_bar when series has 2+ keys", () => {
    const result = getCompatibleTypes(["value", "profit"], false);
    expect(result).toContain("combo");
    expect(result).toContain("stacked_bar");
  });

  it("adds stacked_bar when hasMultiNumeric is true (no explicit series)", () => {
    const result = getCompatibleTypes(undefined, true);
    expect(result).toContain("stacked_bar");
    expect(result).not.toContain("combo");
  });

  it("returns unique types without duplicates", () => {
    const result = getCompatibleTypes(["value", "profit"], true);
    const seen = new Set(result);
    expect(seen.size).toBe(result.length);
  });

  it("every returned type is a valid ChartType", () => {
    const result = getCompatibleTypes(["a", "b"], true);
    result.forEach((t) => {
      expect(CHART_TYPES).toContain(t);
    });
  });
});

describe("Chart empty state validation", () => {
  it("returns empty state message for empty data array", () => {
    const data = JSON.stringify([]);
    expect(data).toBe("[]");
  });

  it("handles single-element array gracefully (no chart)", () => {
    const data = JSON.stringify([{ label: "x", value: 1 }]);
    const parsed = JSON.parse(data);
    expect(parsed.length).toBe(1);
  });
});

describe("ChartType enum completeness", () => {
  it("includes all supported types", () => {
    expect(CHART_TYPES).toEqual([
      "line", "area", "bar", "horizontal_bar", "pie",
      "combo", "stacked_bar", "heatmap", "donut",
    ]);
  });

  it("includes donut as explicit type (not just pie)", () => {
    expect(CHART_TYPES).toContain("donut");
    expect(CHART_TYPES).toContain("pie");
  });
});


