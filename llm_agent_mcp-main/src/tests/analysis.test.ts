import { describe, it, expect } from "vitest";

// Test core analysis utilities in isolation
describe("Data Science Signals Detection", () => {
    // Replicate the signal detection logic from multi-agent.ts
    const DATA_SCIENCE_SIGNALS = [
        "сегментчлэл", "кластер", "кластеризаци", "cluster", "segmentation",
        "forecast", "таамаглал", "прогноз", "predict", "prediction", "цаг хугацааны цуваа",
        "time series", "trend", "трэнд", "anova", "regression", "регресс",
        "outlier detection", "гажуудал илрүүлэх", "anomaly", "3σ", "standard deviation", "z-score",
    ];

    function isDataScienceQuery(query: string): boolean {
        return DATA_SCIENCE_SIGNALS.some(s => query.toLowerCase().includes(s.toLowerCase()));
    }

    it("should detect cluster query", () => {
        expect(isDataScienceQuery("Хэрэглэгчдийн кластеризаци хий")).toBe(true);
    });

    it("should detect forecast query", () => {
        expect(isDataScienceQuery("дараагийн саруудын таамаглал гарга")).toBe(true);
    });

    it("should detect outlier detection", () => {
        expect(isDataScienceQuery("гажуудал илрүүлэх шинжилгээ хий")).toBe(true);
    });

    it("should detect time series", () => {
        expect(isDataScienceQuery("Цаг хугацааны цувааны шинжилгээ")).toBe(true);
    });

    it("should detect regression", () => {
        expect(isDataScienceQuery("регрессийн шинжилгээ хий")).toBe(true);
    });

    it("should detect z-score anomaly", () => {
        expect(isDataScienceQuery("z-score ашиглан outlier илрүүлэх")).toBe(true);
    });

    it("should not trigger on regular queries", () => {
        expect(isDataScienceQuery("Борлуулалтын тайлан харуул")).toBe(false);
    });

    it("should not trigger on KPI queries", () => {
        expect(isDataScienceQuery("Гол KPI үзүүлэлтүүдийг харуул")).toBe(false);
    });

    it("should detect English cluster", () => {
        expect(isDataScienceQuery("customer cluster analysis")).toBe(true);
    });

    it("should detect English anomaly", () => {
        expect(isDataScienceQuery("anomaly detection on sales")).toBe(true);
    });
});

describe("Finance/Business Signals Detection", () => {
    const FINANCE_FUNCTIONS = [
        "kpi", "борлуулалт", "ашиг", "зарлага", "revenue", "expense",
        "income", "sales", "profit", "margin", "өсөлт", "growth",
        "хөрөнгө", "asset", "өр", "liability", "мөнгөн гүйлгээ", "cash flow",
        "төсөв", "budget", "санхүүгийн тайлан", "financial report",
        "dashboard", "гүйцэтгэлийн үзүүлэлт", "тархалт", "distribution",
    ];

    function isFinanceQuery(query: string): boolean {
        return FINANCE_FUNCTIONS.some(s => query.toLowerCase().includes(s.toLowerCase()));
    }

    it("should detect sales query", () => {
        expect(isFinanceQuery("Борлуулалтын тайлан харуул")).toBe(true);
    });

    it("should detect KPI query", () => {
        expect(isFinanceQuery("KPI үзүүлэлтүүдийг харуул")).toBe(true);
    });

    it("should detect dashboard query", () => {
        expect(isFinanceQuery("Dashboard харуул")).toBe(true);
    });

    it("should detect cash flow query", () => {
        expect(isFinanceQuery("мөнгөн гүйлгээний тайлан")).toBe(true);
    });

    it("should detect English revenue", () => {
        expect(isFinanceQuery("Show me revenue reports")).toBe(true);
    });
});
