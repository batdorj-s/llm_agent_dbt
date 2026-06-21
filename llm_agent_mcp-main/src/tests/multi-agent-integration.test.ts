import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock factories (run before imports) ──────────────────────
const mockCreateLLM = vi.hoisted(() => vi.fn());
const mockCreateLLMWithOrder = vi.hoisted(() => vi.fn());
const mockInvokeWithFallback = vi.hoisted(() => vi.fn());
const mockGetCatalog = vi.hoisted(() => vi.fn());
const mockGetActiveCatalogEntry = vi.hoisted(() => vi.fn());
const mockBuildSchemaDefinition = vi.hoisted(() => vi.fn());
const mockHandleExecuteSql = vi.hoisted(() => vi.fn());
const mockIsPythonQuery = vi.hoisted(() => vi.fn());
const mockRunPythonCode = vi.hoisted(() => vi.fn());
const mockSelfQueryTransform = vi.hoisted(() => vi.fn());
const mockSearchKnowledgeBase = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockSearchKnowledgeBaseWithFilter = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock("dotenv", () => ({
    default: { config: vi.fn() },
    config: vi.fn(),
}));

vi.mock("fs", () => ({
    readFileSync: vi.fn().mockReturnValue("mocked"),
    default: { readFileSync: vi.fn().mockReturnValue("mocked") },
}));

vi.mock("yaml", () => ({
    parse: vi.fn().mockReturnValue({
        supervisor: "Route the following query to one of: FinanceAgent, TechAgent, DataScientistAgent, or END. Respond ONLY with valid JSON.",
        supervisor_end: "You are a helpful assistant. Greet the user in Mongolian and explain what you can do.",
        tech_agent_sql_gen: "Generate PostgreSQL SQL from the user query.",
        tech_agent_explain: "Explain the SQL results in Mongolian to a business user.",
        finance_agent: "Answer finance questions using the knowledge base.",
        data_quality_checklist: "Note: data may have quality issues.",
        dashboard_designer: "Generate dashboard widgets.",
    }),
    default: {
        parse: vi.fn().mockReturnValue({
            supervisor: "Route the following query...",
            supervisor_end: "You are a helpful assistant...",
            tech_agent_sql_gen: "Generate PostgreSQL SQL...",
            tech_agent_explain: "Explain the SQL results...",
            finance_agent: "Answer finance questions...",
            data_quality_checklist: "Note: data may have quality issues.",
            dashboard_designer: "Generate dashboard widgets.",
        }),
    },
}));

vi.mock("../llm-provider.js", () => ({
    createLLM: mockCreateLLM,
    createLLMWithOrder: mockCreateLLMWithOrder,
    invokeWithFallback: mockInvokeWithFallback,
}));

vi.mock("../db/data-lake.js", () => ({
    getCatalog: mockGetCatalog,
    getActiveCatalogEntry: mockGetActiveCatalogEntry,
    buildSchemaDefinition: mockBuildSchemaDefinition,
}));

vi.mock("../tools/enterprise-tools.js", () => ({
    handleExecuteSql: mockHandleExecuteSql,
    isPythonQuery: mockIsPythonQuery,
    buildFinanceKpiContext: vi.fn().mockResolvedValue("mocked KPI context"),
}));

vi.mock("../sandbox.js", () => ({
    runPythonCode: mockRunPythonCode,
}));

vi.mock("../rag.js", () => ({
    searchKnowledgeBase: mockSearchKnowledgeBase,
    selfQueryTransform: mockSelfQueryTransform,
    searchKnowledgeBaseWithFilter: mockSearchKnowledgeBaseWithFilter,
}));

vi.mock("../observability/tracer.js", () => ({
    initTracing: vi.fn().mockReturnValue({ handler: null }),
}));

// ── Helper to create a mock LLM ─────────────────────────────────────
function createMockLLM(route: string, reason: string) {
    return {
        withStructuredOutput: () => ({
            invoke: vi.fn().mockResolvedValue({ route, reason }),
        }),
        stream: vi.fn().mockReturnValue({
            [Symbol.asyncIterator]: async function* () {
                yield { content: "This is a mocked response from the agent." };
            },
        }),
        invoke: vi.fn().mockResolvedValue({
            content: "Mocked LLM response",
            tool_calls: [],
            invalid_tool_calls: [],
        }),
    };
}

// ── Tests ───────────────────────────────────────────────────────────
describe("Multi-Agent Integration — Supervisor Node", () => {
    beforeEach(() => {
        mockCreateLLM.mockReset();
        mockCreateLLMWithOrder.mockReset();
        mockGetCatalog.mockReset();
        mockGetActiveCatalogEntry.mockReset();
        mockBuildSchemaDefinition.mockReset();
        mockHandleExecuteSql.mockReset();
        mockIsPythonQuery.mockReset();

        mockGetCatalog.mockResolvedValue([]);
        mockGetActiveCatalogEntry.mockResolvedValue(null);
        mockIsPythonQuery.mockReturnValue(false);
    });

    it("routes to FinanceAgent when LLM returns FinanceAgent", async () => {
        mockCreateLLM.mockResolvedValue(createMockLLM("FinanceAgent", "User is asking about financial targets"));

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "sales target this quarter" }], userRole: "admin" },
            { configurable: { thread_id: "test-sup-fa-1" } }
        );

        expect(result.nextAgent).toBe("FinanceAgent");
    });

    it("routes to TechAgent when LLM returns TechAgent", async () => {
        mockCreateLLM.mockResolvedValue(createMockLLM("TechAgent", "User wants data from a table"));

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "show top 5 products" }], userRole: "admin" },
            { configurable: { thread_id: "test-sup-ta-1" } }
        );

        expect(result.nextAgent).toBe("TechAgent");
    });

    it("routes to DataScientistAgent when LLM returns DataScientistAgent", async () => {
        mockCreateLLM.mockResolvedValue(createMockLLM("DataScientistAgent", "User requests statistical analysis"));

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "perform statistical regression correlation analysis on dataset" }], userRole: "admin" },
            { configurable: { thread_id: "test-sup-ds-1" } }
        );

        expect(result.nextAgent).toBe("DataScientistAgent");
    });

    it("produces greeting when LLM returns END and no active catalog", async () => {
        mockCreateLLM.mockResolvedValue(createMockLLM("END", "User greeting — no specific request"));

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "hello" }], userRole: "admin" },
            { configurable: { thread_id: "test-sup-end-1" } }
        );

        expect(result.nextAgent).toBe("END");
        const lastMsg = result.messages[result.messages.length - 1];
        expect(lastMsg.content).toContain("mocked response");
    });

    it("overrides END to TechAgent when active catalog exists", async () => {
        mockCreateLLM.mockResolvedValue(createMockLLM("END", "Casual greeting"));
        mockGetActiveCatalogEntry.mockResolvedValue({
            id: 1, table_name: "superstore_sales", created_by: null,
            created_at: "2025-01-01", columns_info: '["date","sales"]', description: null,
        });

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "hi there" }], userRole: "admin" },
            { configurable: { thread_id: "test-sup-override-1" } }
        );

        expect(result.nextAgent).toBe("TechAgent");
    });

    it("falls back to keyword routing when createLLM returns null", async () => {
        mockCreateLLM.mockResolvedValue(null);
        mockGetCatalog.mockResolvedValue([]);

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "show top 5 products by sales" }], userRole: "admin" },
            { configurable: { thread_id: "test-sup-fallback-1" } }
        );

        expect(result.nextAgent).toBe("TechAgent");
    });

    it("routes to DataScientistAgent via keyword when createLLM returns null", async () => {
        mockCreateLLM.mockResolvedValue(null);
        mockGetCatalog.mockResolvedValue([]);

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "forecast analysis of sales data" }], userRole: "admin" },
            { configurable: { thread_id: "test-sup-ds-fallback-1" } }
        );

        expect(result.nextAgent).toBe("DataScientistAgent");
    });
});

describe("Multi-Agent Integration — TechAgent Full Chain (deterministic SQL)", () => {
    beforeEach(async () => {
        mockCreateLLM.mockReset();
        mockCreateLLMWithOrder.mockReset();
        mockGetCatalog.mockReset();
        mockGetActiveCatalogEntry.mockReset();
        mockBuildSchemaDefinition.mockReset();
        mockHandleExecuteSql.mockReset();
        mockIsPythonQuery.mockReset();

        mockGetCatalog.mockResolvedValue([]);
        mockIsPythonQuery.mockReturnValue(false);
    });

    it("executes deterministic SQL for top 5 query with valid catalog entry", async () => {
        const catalogEntry = {
            id: 42, table_name: "superstore_sales", created_by: null,
            created_at: "2025-01-01",
            columns_info: '["item_purchased","sales","date"]',
            description: null,
        };
        mockGetActiveCatalogEntry.mockResolvedValue(catalogEntry);
        mockGetCatalog.mockResolvedValue([catalogEntry]);
        mockBuildSchemaDefinition.mockResolvedValue("Table superstore_sales (item_purchased, sales, date)");

        const sqlResult = { ok: true, columns: ["item_name", "total_revenue"], results: [{ item_name: "Laptop", total_revenue: 50000 }] };
        mockHandleExecuteSql.mockResolvedValue(sqlResult);
        mockCreateLLM.mockResolvedValue(createMockLLM("TechAgent", "user wants top 5 data"));

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "top 5 product sales analysis" }], userRole: "admin" },
            { configurable: { thread_id: "test-tech-deterministic-1" } }
        );

        expect(result.nextAgent).toBe("TechAgent");
        expect(mockHandleExecuteSql).toHaveBeenCalled();
    });

    it("uses LLM SQL generation when deterministic path returns null", async () => {
        const catalogEntry = {
            id: 43, table_name: "retail_sales", created_by: null,
            created_at: "2025-01-01",
            columns_info: JSON.stringify(["category", "amount", "date"]),
            description: null,
        };
        mockGetActiveCatalogEntry.mockResolvedValue(catalogEntry);
        mockGetCatalog.mockResolvedValue([catalogEntry]);
        mockBuildSchemaDefinition.mockResolvedValue("Table retail_sales (category, amount, date)");

        const mockModel = createMockLLM("TechAgent", "User wants data from database table");
        mockModel.invoke = vi.fn().mockResolvedValue({
            content: "```sql\nSELECT category, SUM(amount) AS total FROM retail_sales GROUP BY category ORDER BY total DESC;\n```",
        });
        mockCreateLLM.mockResolvedValue(mockModel);
        mockCreateLLMWithOrder.mockResolvedValue(mockModel);

        const sqlResult = { ok: true, columns: ["category", "total"], results: [{ category: "Electronics", total: 150000 }] };
        mockHandleExecuteSql.mockResolvedValue(sqlResult);

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "select category from retail sales sql query" }], userRole: "admin" },
            { configurable: { thread_id: "test-tech-llm-sql-1" } }
        );

        expect(result.nextAgent).toBe("TechAgent");
        expect(mockHandleExecuteSql).toHaveBeenCalled();
    });
});

describe("Multi-Agent Integration — END greeting without LLM", () => {
    beforeEach(async () => {
        mockCreateLLM.mockReset();
        mockGetCatalog.mockReset();
        mockGetActiveCatalogEntry.mockReset();

        mockGetCatalog.mockResolvedValue([]);
        mockGetActiveCatalogEntry.mockResolvedValue(null);
        mockCreateLLM.mockResolvedValue(null);
    });

    it("returns Mongolian greeting when keyword fallback yields END and no active catalog", async () => {
        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "random non-matching text" }], userRole: "admin" },
            { configurable: { thread_id: "test-end-fallback-1" } }
        );

        expect(result.nextAgent).toBe("END");
        const lastMsg = result.messages[result.messages.length - 1];
        expect(lastMsg.content).toContain("Сайн байна уу");
    });
});

describe("Multi-Agent Integration — DataScientist Full Chain", () => {
    const catalogEntry = {
        id: 1, table_name: "superstore_sales", created_by: null,
        created_at: "2025-01-01",
        columns_info: JSON.stringify(["sales", "date", "category", "region"]),
        description: null,
    };
    const schemaDef = [
        "- date (INT, 1024 distinct) [43537..45000]",
        "  Sample values: 43537, 43538",
        "- sales (DEC, 512 distinct) [0..10000]",
        "  Sample values: 100, 200",
        "- category (VARCHAR, 50 distinct)",
        "  Sample values: Electronics, Furniture",
        "- region (VARCHAR, 10 distinct)",
        "  Sample values: East, West",
    ].join("\n");
    const sampleResults = [
        { sales: 200, date: 43537, category: "Electronics", region: "East" },
        { sales: 150, date: 43538, category: "Furniture", region: "West" },
    ];

    beforeEach(() => {
        mockCreateLLM.mockReset();
        mockCreateLLMWithOrder.mockReset();
        mockInvokeWithFallback.mockReset();
        mockGetCatalog.mockReset();
        mockGetActiveCatalogEntry.mockReset();
        mockBuildSchemaDefinition.mockReset();
        mockHandleExecuteSql.mockReset();
        mockIsPythonQuery.mockReset();
        mockRunPythonCode.mockReset();
        mockSelfQueryTransform.mockReset();
        mockSearchKnowledgeBase.mockReset();
        mockSearchKnowledgeBaseWithFilter.mockReset();

        mockGetCatalog.mockResolvedValue([]);
        mockGetActiveCatalogEntry.mockResolvedValue(catalogEntry);
        mockBuildSchemaDefinition.mockResolvedValue(schemaDef);
        mockSearchKnowledgeBase.mockResolvedValue({ documents: [[]] });
        mockSearchKnowledgeBaseWithFilter.mockResolvedValue({ documents: [[]] });
    });

    it("generates Python code, runs it in sandbox, and returns explanation", async () => {
        const mockModel = createMockLLM("DataScientistAgent", "User requests regression analysis");
        mockCreateLLM.mockResolvedValue(mockModel);
        mockSelfQueryTransform.mockRejectedValue(new Error("self-query not needed"));

        mockInvokeWithFallback.mockResolvedValue({
            content: "Here is the analysis:\n```python\nimport pandas as pd\ndf = pd.DataFrame(data)\nprint(df.describe())\nprint('##CHART_SAVED##')\n```",
        });

        mockHandleExecuteSql.mockResolvedValue({
            ok: true,
            columns: ["sales", "date", "category", "region"],
            results: sampleResults,
        });

        mockRunPythonCode.mockResolvedValue("       sales  \ncount   2.0   \nmean  175.0   \n##CHART_SAVED##");

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "run regression on sales data" }], userRole: "admin" },
            { configurable: { thread_id: "test-ds-full-1" } }
        );

        expect(result.nextAgent).toBe("DataScientistAgent");
        expect(mockInvokeWithFallback).toHaveBeenCalled();
        expect(mockRunPythonCode).toHaveBeenCalled();
        const lastMsg = result.messages[result.messages.length - 1];
        expect(lastMsg.content).toContain("import pandas as pd");
        expect(lastMsg.content).toContain("sales");
    });

    it("includes <img> tag when sandbox returns a base64 chart", async () => {
        const mockModel = createMockLLM("DataScientistAgent", "User requests chart for correlation analysis");
        mockCreateLLM.mockResolvedValue(mockModel);
        mockSelfQueryTransform.mockRejectedValue(new Error("self-query not needed"));

        mockInvokeWithFallback.mockResolvedValue({
            content: "```python\nimport matplotlib.pyplot as plt\nplt.plot([1,2,3])\nplt.savefig('analysis_plot.png')\nprint('##CHART_SAVED##')\n```",
        });

        mockHandleExecuteSql.mockResolvedValue({
            ok: true,
            columns: ["sales"],
            results: sampleResults,
        });

        mockRunPythonCode.mockResolvedValue("##CHART_SAVED##\n##BASE64_IMAGE:iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==\n");

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "find correlation between sales and date" }], userRole: "admin" },
            { configurable: { thread_id: "test-ds-chart-1" } }
        );

        const lastMsg = result.messages[result.messages.length - 1];
        expect(lastMsg.content).toContain("<img");
        expect(lastMsg.content).toContain("data:image/png;base64");
    });

    it("returns Mongolian error message when sandbox throws", async () => {
        const mockModel = createMockLLM("DataScientistAgent", "User requests cluster analysis");
        mockCreateLLM.mockResolvedValue(mockModel);
        mockSelfQueryTransform.mockRejectedValue(new Error("self-query not needed"));

        mockInvokeWithFallback.mockResolvedValue({
            content: "```python\nimport pandas as pd\ndf = pd.DataFrame(data)\nprint(df['nonexistent'])\n```",
        });

        mockHandleExecuteSql.mockResolvedValue({
            ok: true,
            columns: ["sales"],
            results: sampleResults,
        });

        mockRunPythonCode.mockRejectedValue(new Error("name 'nonexistent' not defined"));

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "cluster customers by sales region" }], userRole: "admin" },
            { configurable: { thread_id: "test-ds-error-1" } }
        );

        const lastMsg = result.messages[result.messages.length - 1];
        expect(lastMsg.content).toContain("АНХААР");
        expect(lastMsg.content).toContain("алдаа");
        expect(lastMsg.content).toContain("nonexistent");
    });

    it("returns fallback when no active catalog entry exists", async () => {
        mockGetActiveCatalogEntry.mockResolvedValue(null);

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "perform regression analysis" }], userRole: "admin" },
            { configurable: { thread_id: "test-ds-no-catalog-1" } }
        );

        const lastMsg = result.messages[result.messages.length - 1];
        expect(lastMsg.content).toContain("АНХААР");
        expect(lastMsg.content).toContain("Идэвхтэй хүснэгт");
        expect(mockInvokeWithFallback).not.toHaveBeenCalled();
    });

    it("returns fallback when LLM is not configured", async () => {
        mockCreateLLM.mockResolvedValue(null);

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "predict future sales trends" }], userRole: "admin" },
            { configurable: { thread_id: "test-ds-no-llm-1" } }
        );

        const lastMsg = result.messages[result.messages.length - 1];
        expect(lastMsg.content).toContain("АНХААР");
        expect(lastMsg.content).toContain("LLM API key");
        expect(mockInvokeWithFallback).not.toHaveBeenCalled();
    });

    it("uses forecast analysis path when query contains forecast keywords", async () => {
        const mockModel = createMockLLM("DataScientistAgent", "User wants forecast");
        mockCreateLLM.mockResolvedValue(mockModel);
        mockSelfQueryTransform.mockRejectedValue(new Error("self-query not needed"));

        mockInvokeWithFallback.mockResolvedValue({
            content: "```python\nimport pandas as pd\nprint('forecast analysis')\nprint('##CHART_SAVED##')\n```",
        });

        mockHandleExecuteSql.mockResolvedValue({
            ok: true,
            columns: ["sales", "date"],
            results: sampleResults,
        });

        mockRunPythonCode.mockResolvedValue("forecast analysis\n##CHART_SAVED##");

        const { multiAgentApp } = await import("../multi-agent.js");
        const result = await multiAgentApp.invoke(
            { messages: [{ role: "user", content: "forecast sales for next quarter" }], userRole: "admin" },
            { configurable: { thread_id: "test-ds-forecast-1" } }
        );

        expect(mockInvokeWithFallback).toHaveBeenCalled();
        const lastMsg = result.messages[result.messages.length - 1];
        expect(lastMsg.content).toContain("forecast analysis");
    });
});
