import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  handleGetKpi,
  handleGetSalesHistory,
  handleGetCatalog,
  handleExecuteSql,
} from "./enterprise-tools.js";

export function buildEnterpriseLangChainTools(userId: string) {
  const getKpiTool = tool(
    async ({ metric }) => {
      console.log(`[LangChain Tool] get_kpi metric="${metric}"`);
      const result = await handleGetKpi({ metric });
      return result.text;
    },
    {
      name: "get_kpi",
      description:
        "Fetches the current value and target for a business KPI (sales, users, churn_rate).",
      schema: z.object({
        metric: z.enum(["sales", "users", "churn_rate"]).describe("KPI metric to retrieve."),
      }),
    }
  );

  const getSalesHistoryTool = tool(
    async ({ limit }) => {
      console.log(`[LangChain Tool] get_sales_history limit=${limit}`);
      const result = await handleGetSalesHistory({ limit });
      return result.text;
    },
    {
      name: "get_sales_history",
      description: "Fetches monthly sales revenue history.",
      schema: z.object({
        limit: z.number().min(1).max(12).optional().describe("Months to retrieve (default 3)."),
      }),
    }
  );

  const executeSqlTool = tool(
    async ({ query }) => {
      console.log(`[LangChain Tool] execute_sql`);
      const result = await handleExecuteSql({ query, userId });
      return result.text;
    },
    {
      name: "execute_sql",
      description: "Executes a SELECT query against the Data Lake (PostgreSQL).",
      schema: z.object({
        query: z.string().describe("SQL SELECT query."),
      }),
    }
  );

  const getCatalogTool = tool(
    async () => {
      console.log(`[LangChain Tool] get_data_lake_catalog`);
      const result = await handleGetCatalog({ userId });
      return result.text;
    },
    {
      name: "get_data_lake_catalog",
      description: "Returns metadata about all tables in the Data Lake.",
      schema: z.object({}),
    }
  );

  return [getKpiTool, getSalesHistoryTool, executeSqlTool, getCatalogTool];
}
