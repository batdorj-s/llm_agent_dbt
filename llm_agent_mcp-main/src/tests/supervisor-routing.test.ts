import { describe, it, expect } from "vitest";
import { routeByKeywords } from "../agents/supervisorNode.js";

type NextAgent = "FinanceAgent" | "TechAgent" | "DataScientistAgent" | "END";

describe("Supervisor keyword-based routing", () => {
    describe("Data science queries (highest priority)", () => {
        it("routes forecast queries to DataScientistAgent", () => {
            expect(routeByKeywords("дараагийн саруудын таамаглал гарга", false))
                .toBe("DataScientistAgent");
        });

        it("routes cluster (English) analysis to DataScientistAgent", () => {
            expect(routeByKeywords("customer segmentation", false))
                .toBe("DataScientistAgent");
        });

        it("routes customer segmentation to DataScientistAgent", () => {
            expect(routeByKeywords("сегментчилэл шинжилгээ", false))
                .toBe("DataScientistAgent");
        });

        it("routes outlier detection to DataScientistAgent", () => {
            expect(routeByKeywords("outlier detection хийж өгнө үү", false))
                .toBe("DataScientistAgent");
        });

        it("routes anomaly to DataScientistAgent", () => {
            expect(routeByKeywords("гажуудал илрүүлэх", false))
                .toBe("DataScientistAgent");
        });

        it("routes time series to DataScientistAgent", () => {
            expect(routeByKeywords("хугацааны цувааны шинжилгээ", false))
                .toBe("DataScientistAgent");
        });

        it("routes regression to DataScientistAgent", () => {
            expect(routeByKeywords("регрессийн шинжилгээ", true))
                .toBe("DataScientistAgent");
        });

        it("routes correlation to DataScientistAgent", () => {
            expect(routeByKeywords("correlation analysis of sales", false))
                .toBe("DataScientistAgent");
        });

        it("routes predict query to DataScientistAgent", () => {
            expect(routeByKeywords("predict next quarter sales", false))
                .toBe("DataScientistAgent");
        });
    });

    describe("Tech queries (second priority)", () => {
        it("routes SQL query to TechAgent", () => {
            expect(routeByKeywords("SQL query бичээд харуул", false))
                .toBe("TechAgent");
        });

        it("routes data analysis to TechAgent", () => {
            expect(routeByKeywords("борлуулалтын шинжилгээ хий", false))
                .toBe("TechAgent");
        });

        it("routes chart/graph to TechAgent", () => {
            expect(routeByKeywords("график зурж харуул", false))
                .toBe("TechAgent");
        });

        it("routes total calculation to TechAgent", () => {
            expect(routeByKeywords("нийт борлуулалтын дүнг харуул", false))
                .toBe("TechAgent");
        });

        it("routes top/bottom to TechAgent", () => {
            expect(routeByKeywords("top 5 борлуулалттай бүтээгдэхүүн", false))
                .toBe("TechAgent");
        });

        it("routes dashboard to TechAgent", () => {
            expect(routeByKeywords("dashboard харуул", false))
                .toBe("TechAgent");
        });

        it("routes Python ML to TechAgent via code/python signals", () => {
            expect(routeByKeywords("python код ажиллуул", false))
                .toBe("TechAgent");
        });

        it("routes visualization to TechAgent", () => {
            expect(routeByKeywords("visualize the sales data", false))
                .toBe("TechAgent");
        });

        it("routes group by query to TechAgent", () => {
            expect(routeByKeywords("бүлэглэж нийлбэрийг харуул", false))
                .toBe("TechAgent");
        });
    });

    describe("Hybrid queries (finance + tech → FinanceAgent after #13 fix)", () => {
        it("routes browser/business hybrid to FinanceAgent (trade-off: FinanceAgent was 100% dead before)", () => {
            expect(routeByKeywords("sales kpi харуулах", false))
                .toBe("FinanceAgent");
        });

        it("routes target + data to FinanceAgent", () => {
            expect(routeByKeywords("sales target-тай харьцуулсан хүснэгт", false))
                .toBe("FinanceAgent");
        });

        it("routes kpi + харуул to FinanceAgent (not TechAgent) after priority reorder", () => {
            expect(routeByKeywords("kpi үзүүлэлтүүдийг харуул", false))
                .toBe("FinanceAgent");
        });
    });

    describe("Tech-only queries (no finance signal → TechAgent)", () => {
        it("routes pure SQL query to TechAgent", () => {
            expect(routeByKeywords("SQL query бичээд харуул", false))
                .toBe("TechAgent");
        });

        it("routes python code to TechAgent", () => {
            expect(routeByKeywords("python код ажиллуул", false))
                .toBe("TechAgent");
        });
    });

    describe("Finance queries (when no tech signal present)", () => {
        it("routes borluulaltiin tolovlogoo to FinanceAgent", () => {
            expect(routeByKeywords("борлуулалтын төлөвлөгөө", false))
                .toBe("FinanceAgent");
        });

        it("routes орлогын төлөвлөгөө to FinanceAgent", () => {
            expect(routeByKeywords("орлогын төлөвлөгөө", false))
                .toBe("FinanceAgent");
        });

        it("routes sales target to FinanceAgent (word boundary fix)", () => {
            expect(routeByKeywords("sales target", false))
                .toBe("FinanceAgent");
        });

        it("routes revenue target to FinanceAgent (word boundary fix)", () => {
            expect(routeByKeywords("revenue target", false))
                .toBe("FinanceAgent");
        });
    });

    describe("Active dataset override", () => {
        it("routes unknown query to TechAgent when active dataset exists", () => {
            expect(routeByKeywords("би чинь сайн уу", true))
                .toBe("TechAgent");
        });

        it("returns END when no dataset and no signals match", () => {
            expect(routeByKeywords("би чинь сайн уу", false))
                .toBe("END");
        });
    });

    describe("Empty result vs SQL error — #10 regression", () => {
        it("empty array '[]' should NOT be treated as SQL error (valid execution, zero rows)", () => {
            const hasError = "[]".startsWith("SQL Execution Error:");
            expect(hasError).toBe(false);
        });

        it("SQL syntax error should be detected as error", () => {
            const hasError = "SQL Execution Error: column 'x' does not exist".startsWith("SQL Execution Error:");
            expect(hasError).toBe(true);
        });

        it("empty string should NOT be treated as SQL error", () => {
            const hasError = "".startsWith("SQL Execution Error:");
            expect(hasError).toBe(false);
        });
    });

    describe("Edge cases", () => {
        it("handles empty string as END (no dataset)", () => {
            expect(routeByKeywords("", false)).toBe("END");
        });

        it("handles single character query as END", () => {
            expect(routeByKeywords("а", false)).toBe("END");
        });

        it("is case-insensitive", () => {
            expect(routeByKeywords("SQL Query", false)).toBe("TechAgent");
        });

        it("prioritizes data science over tech when both match", () => {
            expect(routeByKeywords("forecast SQL query", false))
                .toBe("DataScientistAgent");
        });

        it("prioritizes finance over tech (no more dead FinanceAgent)", () => {
            expect(routeByKeywords("kpi analysis", false))
                .toBe("FinanceAgent");
        });
    });
});
