import { describe, it, expect } from "vitest";
import { buildDbtTestRagDocs } from "../dbt-sync.js";

interface ResultInput {
  unique_id: string;
  status: string;
  failures?: number;
  message?: string;
}

function result({ unique_id, status, failures = 0, message }: ResultInput) {
  return { unique_id, status, failures, message };
}

const emptyNodes: never[] = [];

describe("buildDbtTestRagDocs", () => {
  it("ignores model run results (status 'success') instead of counting them as failed tests", () => {
    const { passed, failed, skipped, docs } = buildDbtTestRagDocs(
      [
        result({ unique_id: "model.data_transformations.stg_transactions", status: "success" }),
        result({ unique_id: "model.data_transformations.kpi_sales", status: "success" }),
      ],
      emptyNodes
    );

    expect(passed).toBe(0);
    expect(failed).toBe(0);
    expect(skipped).toBe(0);
    expect(docs).toEqual([]);
  });

  it("counts passing test results and generates only the summary document", () => {
    const { passed, failed, skipped, docs } = buildDbtTestRagDocs(
      [
        result({ unique_id: "test.data_transformations.not_null_stg_transactions_id", status: "pass" }),
        result({ unique_id: "test.data_transformations.unique_stg_transactions_id", status: "pass" }),
      ],
      emptyNodes
    );

    expect(passed).toBe(2);
    expect(failed).toBe(0);
    expect(skipped).toBe(0);
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe("dbt_test_summary");
    expect(docs[0].text).toContain("2 total, 2 passed, 0 failed");
  });

  it("treats warn and skipped statuses as non-failures", () => {
    const { passed, failed, skipped } = buildDbtTestRagDocs(
      [
        result({ unique_id: "test.data_transformations.warned_test", status: "warn" }),
        result({ unique_id: "test.data_transformations.skipped_test", status: "skipped" }),
      ],
      emptyNodes
    );

    expect(passed).toBe(1);
    expect(skipped).toBe(1);
    expect(failed).toBe(0);
  });

  it("creates a warning document for each failed test with model context", () => {
    const testNodes = [
      {
        name: "not_null_stg_transactions_id",
        resource_type: "test",
        test_metadata: { name: "not_null", kwargs: {} },
        column_name: "id",
        depends_on: { nodes: ["model.data_transformations.stg_transactions"] },
      },
    ] as Parameters<typeof buildDbtTestRagDocs>[1];

    const { passed, failed, docs } = buildDbtTestRagDocs(
      [
        result({
          unique_id: "test.data_transformations.not_null_stg_transactions_id",
          status: "fail",
          failures: 3,
          message: "Got 3 results, expected 0",
        }),
      ],
      testNodes
    );

    expect(passed).toBe(0);
    expect(failed).toBe(1);
    expect(docs).toHaveLength(2); // warning + summary

    const warning = docs.find((d) => d.id === "dbt_warning_not_null_stg_transactions_id");
    expect(warning).toBeDefined();
    expect(warning!.text).toContain("not_null_stg_transactions_id");
    expect(warning!.text).toContain("Affected model: stg_transactions");
    expect(warning!.text).toContain("Got 3 results, expected 0");
    expect(warning!.text).toContain("3 failures");
  });

  it("counts error status as a failed test", () => {
    const { passed, failed, docs } = buildDbtTestRagDocs(
      [
        result({ unique_id: "test.data_transformations.broken_test", status: "error", message: "dbt error" }),
      ],
      emptyNodes
    );

    expect(failed).toBe(1);
    expect(passed).toBe(0);
    expect(docs.some((d) => d.id === "dbt_warning_broken_test")).toBe(true);
  });

  it("produces no docs at all when there are no test results", () => {
    const { passed, failed, docs } = buildDbtTestRagDocs([], emptyNodes);
    expect(passed).toBe(0);
    expect(failed).toBe(0);
    expect(docs).toEqual([]);
  });
});
