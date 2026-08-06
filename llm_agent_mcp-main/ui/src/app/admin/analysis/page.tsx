"use client";

/**
 * Admin Analysis — read-only SQL tool against the data lake.
 * Uses GET /api/admin/analysis/tables + POST /api/admin/analysis/sql (admin:system).
 */

import React, { useEffect, useMemo, useState } from "react";
import { useCustom, type HttpError } from "@refinedev/core";
import { Play, Table2, Terminal, Loader2, AlertTriangle } from "lucide-react";

type LakeTable = {
  table_name: string;
  columns: string[];
  description: string | null;
  created_at: string;
};

type SqlResultData = {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
};

const DEFAULT_SQL = (tableName: string) =>
  tableName
    ? `SELECT *\nFROM "${tableName}"\nLIMIT 50;`
    : "-- Хүснэгт сонгоод SELECT асуулга бичнэ үү\nSELECT 1 AS ok;";

function fmtCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function AdminAnalysisPage() {
  const [selectedTable, setSelectedTable] = useState("");
  const [sql, setSql] = useState(DEFAULT_SQL(""));
  const [result, setResult] = useState<SqlResultData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);

  const tablesQuery = useCustom<LakeTable[]>({
    url: "/api/admin/analysis/tables",
    method: "get",
  });

  const sqlQuery = useCustom<SqlResultData, HttpError, unknown, { query: string }>({
    url: "/api/admin/analysis/sql",
    method: "post",
    config: { payload: { query: sql } },
  });

  const tables = tablesQuery.result.data ?? [];
  const isLoadingTables = tablesQuery.query.isLoading;
  const isRunning = sqlQuery.query.isLoading;

  useEffect(() => {
    if (!hasRun) return;
    if (sqlQuery.query.isError) {
      setError((sqlQuery.query.error as unknown as Error | undefined)?.message ?? "SQL алдаа гарлаа");
      setResult(null);
    } else if (sqlQuery.result.data) {
      setResult(sqlQuery.result.data as unknown as SqlResultData);
      setError(null);
    }
  }, [sqlQuery.query.isError, sqlQuery.query.isLoading, sqlQuery.result.data, hasRun]);

  const runQuery = () => {
    setHasRun(true);
    sqlQuery.query.refetch();
  };

  const pickTable = (tableName: string) => {
    setSelectedTable(tableName);
    setSql(DEFAULT_SQL(tableName));
  };

  const executeButtonDisabled = useMemo(
    () => isRunning || sql.trim().length === 0,
    [isRunning, sql]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">SQL Шинжилгээ</h1>
        <p className="text-xs text-foreground/50 mt-1">
          Data Lake дээр read-only SELECT асуулга ажиллуулах
        </p>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs text-foreground/70">
          Зөвхөн SELECT асуулга зөвшөөрөгдөнө. Өгөгдөл өөрчлөгдөхгүй — бүх асуулга read-only
          транзакц дотор ажиллана.
        </p>
      </div>

      {/* Table picker */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Table2 className="w-4 h-4 text-foreground/40" />
          <h2 className="text-sm font-semibold text-foreground">Хүснэгт сонгох</h2>
        </div>
        {isLoadingTables ? (
          <div className="text-xs text-foreground/50">Хүснэгтүүд ачааллаж байна...</div>
        ) : tables.length === 0 ? (
          <div className="text-xs text-foreground/50">Хуваалцсан хүснэгт байхгүй</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tables.map((t) => (
              <button
                key={t.table_name}
                onClick={() => pickTable(t.table_name)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  selectedTable === t.table_name
                    ? "border-blue-500/50 bg-blue-500/10 text-blue-600"
                    : "border-border bg-card text-foreground/60 hover:text-foreground/90 hover:border-foreground/20"
                }`}
              >
                {t.table_name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* SQL editor */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Terminal className="w-4 h-4 text-foreground/40" />
          <h2 className="text-sm font-semibold text-foreground">SQL асуулга</h2>
        </div>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          spellCheck={false}
          rows={8}
          className="w-full bg-card border border-border rounded-xl p-4 font-mono text-xs text-foreground focus:outline-none focus:border-blue-500/50 resize-y"
          placeholder="SELECT ..."
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-foreground/40 font-mono">
            {selectedTable && `Сонгосон: ${selectedTable}`}
          </span>
          <button
            onClick={runQuery}
            disabled={executeButtonDisabled}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isRunning ? "Ажиллаж байна..." : "Гүйцэтгэх"}
          </button>
        </div>
      </div>

      {/* Result */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-xs font-semibold text-red-500">Алдаа</span>
          </div>
          <pre className="text-xs text-red-500/80 font-mono whitespace-pre-wrap">{error}</pre>
        </div>
      )}

      {result && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-sm font-semibold text-foreground">Үр дүн</h2>
            <span className="text-[10px] text-foreground/40">
              {result.rowCount} мөр · {result.durationMs}ms
            </span>
          </div>
          {result.columns.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-6 text-center text-sm text-foreground/50">
              Үр дүнгийн мөр байхгүй
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-card border-b border-border">
                  <tr>
                    {result.columns.map((col) => (
                      <th
                        key={col}
                        className="px-3 py-2 text-[10px] font-semibold text-foreground/50 uppercase tracking-wider whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-foreground/5">
                      {result.columns.map((col) => (
                        <td
                          key={col}
                          className="px-3 py-1.5 text-foreground/80 font-mono whitespace-nowrap max-w-[320px] truncate"
                        >
                          {fmtCell(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
