import { describe, it, expect } from "vitest";

type NextAgent = "FinanceAgent" | "TechAgent" | "DataScientistAgent" | "END";

// Replicate the EXACT signals from multi-agent.ts supervisorNode
const techSignals = [
    "sql", "database", "table", "tables", "column", "columns", "хүснэгт", "багана",
    "code", "python", "pandas", "matplotlib", "math", "calculate", "analysis", "item purchased", "purchased",
    "top 5", "first 5", "эхний 5", "хамгийн их", "дата", "өгөгдөл", "query", "код ажиллуул",
    "харуул", "нийт", "нийлбэр", "дундаж", "тоо", "тоолох", "жагсаал", "жагсаалт",
    "шинжилгээ", "шинжил", "задла", "задлан", "гаргаж", "гаргах", "тооцо", "тооцоол",
    "хамгийн бага", "хамгийн өндөр",
    "хэд", "хэдэн", "нийт хэдэн", "гүйлгээ", "бүтээгдэхүүн", "бараа",
    "chart", "graph", "visualize", "plot", "харагдуул", "зур",
    "dashboard", "ханалтын самбар", "хана", "widget", "вижет",
    "count", "sum", "average", "avg", "total", "group by", "order by", "where", "filter",
    "show me", "list", "give me", "find", "get", "fetch", "select",
    "өгөгдөл", "мэдээлэл", "харуулах", "тооцоолох", "тооцоо",
    "шүүх", "шүүлт", "фильтр", "фильтрлэх", "бүлэглэх", "бүлэг",
    "эрэмбэлэх", "эрэмбэ", "ангилах", "ангилал",
    "мөр", "мөрүүд", "утга", "утгууд",
    "analyze", "analytics", "report", "top", "bottom",
    "highest", "lowest", "maximum", "minimum", "summarize", "summary",
    "aggregate", "trend", "compare", "comparison",
    "rank", "percentage", "distribution", "breakdown",
    "describe", "stats", "statistics", "overview",
    "first", "last", "limit", "offset",
    "purchase", "channel", "suva", "суваг", "худалдан авалт", "худалдаа",
    "platform", "платформ", "source", "эх сурвалж",
    "даргаар", "зарлага", "зардал", "кампанит",
    "campaign", "marketing", "маркетинг", "ad", "advertising", "зар",
    "conversion", "хөрвүүлэлт", "impression", "reach",
    "click", "тогших", "rate", "cost", "spend",
];

const dataScienceSignals = [
    "таамагла", "forecast", "predict", "ирээдүй", "дараагийн", "урьдчилан",
    "хандлага", "trend analysis", "seasonal", "seasonality",
    "бүлэглэлт", "cluster", "customer segmentation", "сегментчилэл",
    "корреляци", "correlation", "хамаарал", "нөлөөлөл",
    "regression", "регресс", "linear model", "machine learning",
    "anova", "t-test", "chi-square", "hypothesis", "статистик тест",
    "outlier detection", "гажуудал илрүүлэх", "anomaly",
    "prophet", "arima", "time series", "хугацааны цуваа",
    "k-means", "kmeans", "pca", "dimension reduction",
    "feature importance", "coefficient", "р square", "r-squared",
    "deep learning", "нейрон", "neural",
];

const financeSignals = [
    "sales target", "revenue target", "profit target", "margin target", "kpi", "kpi target",
    "борлуулалтын төлөвлөгөө", "орлогын төлөвлөгөө", "ашгийн төлөвлөгөө",
];

// Replicate the exact routing logic from supervisorNode (including word-boundary fix)
function hasSignal(text: string, signal: string): boolean {
    if (/^[a-zA-Z0-9_.\-+]+$/.test(signal)) {
        const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
    }
    return text.includes(signal);
}

function routeByKeywords(
    query: string,
    hasActiveDataset: boolean
): NextAgent {
    const lower = query.toLowerCase();

    const hasTech = techSignals.some((word) => hasSignal(lower, word));
    const hasDataScience = dataScienceSignals.some((word) => hasSignal(lower, word));
    const hasFinance = financeSignals.some((word) => hasSignal(lower, word));

    if (hasDataScience) return "DataScientistAgent";
    if (hasTech && hasFinance) return "TechAgent";
    if (hasTech) return "TechAgent";
    if (hasFinance) return "FinanceAgent";
    if (hasActiveDataset) return "TechAgent";
    return "END";
}

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

    describe("Hybrid queries (tech + finance → TechAgent)", () => {
        it("routes browser/business hybrid to TechAgent", () => {
            expect(routeByKeywords("sales kpi харуулах", false))
                .toBe("TechAgent");
        });

        it("routes target + data to TechAgent", () => {
            expect(routeByKeywords("sales target-тай харьцуулсан хүснэгт", false))
                .toBe("TechAgent");
        });
    });

    describe("Finance queries (when no tech signal present)", () => {
        it("routes borluulaltiin tolovlogoo query to FinanceAgent", () => {
            expect(routeByKeywords("борлуулалтын төлөвлөгөө", false))
                .toBe("FinanceAgent");
        });

        it("routes орлогын төлөвлөгөө to FinanceAgent", () => {
            expect(routeByKeywords("орлогын төлөвлөгөө", false))
                .toBe("FinanceAgent");
        });

        it("routes sales target query to FinanceAgent (word boundary fix)", () => {
            expect(routeByKeywords("sales target", false))
                .toBe("FinanceAgent");
        });

        it("routes revenue target query to FinanceAgent (word boundary fix)", () => {
            expect(routeByKeywords("revenue target", false))
                .toBe("FinanceAgent");
        });

        it("routes hybrid (kpi + show) to TechAgent (not Finance)", () => {
            // "харуул" is a tech signal → hybrid → TechAgent
            expect(routeByKeywords("kpi үзүүлэлтүүдийг харуул", false))
                .toBe("TechAgent");
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
    });
});
