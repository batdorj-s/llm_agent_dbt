"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle, XCircle, Activity, Clock, Database, ChevronDown, ChevronUp } from "lucide-react";

interface QualitySummary {
  available: boolean;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  totalTimeSec: number;
  elapsedTime?: number;
  timestamp: string;
  message?: string;
}

interface TestResult {
  unique_id: string;
  status: "pass" | "fail" | "error";
  failures: number;
  message: string | null;
  execution_time: number;
  test_name: string;
  test_type: string;
  column_name: string | null;
  model_name: string | null;
  expression: string | null;
}

export function DataQualityDashboard({ token }: { token: string | null }) {
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [tests, setTests] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [expandedTest, setExpandedTest] = useState<string | null>(null);

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/data-quality/summary", { headers });
      const data = await res.json();
      if (data.success) setSummary(data.data);
    } catch { /* ignore */ }
  }, []);

  const fetchTests = useCallback(async () => {
    try {
      const params = filterStatus ? `?status=${filterStatus}` : "";
      const res = await fetch(`/api/data-quality/tests${params}`, { headers });
      const data = await res.json();
      if (data.success) setTests(data.data);
    } catch { /* ignore */ }
  }, [filterStatus]);

  useEffect(() => {
    Promise.all([fetchSummary(), fetchTests()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchTests();
  }, [filterStatus]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-foreground/30 text-xs animate-pulse">Ачаалж байна...</div>
      </div>
    );
  }

  if (summary && !summary.available) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-foreground/40 gap-3">
        <Database className="w-10 h-10 opacity-30" />
        <div className="text-xs">Өгөгдлийн чанарын тестийн үр дүн олдсонгүй</div>
        <div className="text-[10px] text-foreground/30">dbt test ажиллуулаад дахин оролдоно уу</div>
      </div>
    );
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case "pass": return <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />;
      case "fail": return <XCircle className="w-3.5 h-3.5 text-red-500" />;
      default: return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
    }
  };

  const failedTests = tests.filter((t) => t.status === "fail" || t.status === "error");
  const passedCount = tests.filter((t) => t.status === "pass").length;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Summary cards */}
      <div className="px-4 py-3 border-b border-border grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-foreground/50 mb-1">
            <Activity className="w-3 h-3" />
            <span className="text-[10px] font-medium">Нийт тест</span>
          </div>
          <div className="text-lg font-bold text-foreground">{summary?.total ?? 0}</div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-foreground/50 mb-1">
            <CheckCircle className="w-3 h-3 text-emerald-500" />
            <span className="text-[10px] font-medium">Амжилттай</span>
          </div>
          <div className="text-lg font-bold text-emerald-500">{summary?.passed ?? 0}</div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-foreground/50 mb-1">
            <XCircle className="w-3 h-3 text-red-500" />
            <span className="text-[10px] font-medium">Амжилтгүй</span>
          </div>
          <div className="text-lg font-bold text-red-500">{summary?.failed ?? 0}</div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-foreground/50 mb-1">
            <Clock className="w-3 h-3" />
            <span className="text-[10px] font-medium">Pass Rate</span>
          </div>
          <div className="text-lg font-bold" style={{ color: (summary?.passRate ?? 0) >= 80 ? "#10b981" : (summary?.passRate ?? 0) >= 50 ? "#f59e0b" : "#ef4444" }}>
            {summary?.passRate ?? 0}%
          </div>
        </div>
      </div>

      {/* Pass rate bar */}
      {summary && summary.total > 0 && (
        <div className="px-4 pt-3">
          <div className="w-full h-2 rounded-full bg-foreground/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${summary.passRate}%`,
                backgroundColor: summary.passRate >= 80 ? "#10b981" : summary.passRate >= 50 ? "#f59e0b" : "#ef4444",
              }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[9px] text-foreground/30">
            <span>{summary.passed} passed</span>
            <span>{summary.totalTimeSec}s execution</span>
            <span>{summary.failed} failed</span>
          </div>
        </div>
      )}

      {/* Filter + test list */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <span className="text-[10px] font-medium text-foreground/50">Шүүлт:</span>
        {["", "pass", "fail", "error"].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
              filterStatus === s
                ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                : "bg-foreground/5 text-foreground/50 hover:bg-foreground/10"
            }`}
          >
            {s === "" ? "Бүгд" : s === "pass" ? "Амжилттай" : s === "fail" ? "Амжилтгүй" : "Алдаа"}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-foreground/30">{tests.length} тест</span>
      </div>

      {/* Test results */}
      <div className="flex-1 overflow-y-auto">
        {tests.length === 0 && (
          <div className="flex items-center justify-center py-12 text-foreground/40">
            <div className="text-xs">Тестийн үр дүн олдсонгүй</div>
          </div>
        )}

        {tests.map((test) => (
          <div key={test.unique_id} className="border-b border-border/40 last:border-b-0">
            <button
              onClick={() => setExpandedTest(expandedTest === test.unique_id ? null : test.unique_id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-foreground/5 transition-colors cursor-pointer text-left border-none bg-transparent"
            >
              {statusIcon(test.status)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{test.test_name}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                    test.status === "pass"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : test.status === "fail"
                      ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}>
                    {test.status}
                  </span>
                  {test.failures > 0 && (
                    <span className="text-[9px] text-red-500/70">{test.failures} алдаа</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[9px] text-foreground/40">{test.test_type}</span>
                  {test.model_name && <span className="text-[9px] text-foreground/40">· {test.model_name}</span>}
                  {test.column_name && <span className="text-[9px] text-foreground/40">· {test.column_name}</span>}
                  <span className="text-[9px] text-foreground/30 ml-auto">{test.execution_time.toFixed(2)}s</span>
                </div>
              </div>
              {expandedTest === test.unique_id ? <ChevronUp className="w-3 h-3 text-foreground/30" /> : <ChevronDown className="w-3 h-3 text-foreground/30" />}
            </button>

            {expandedTest === test.unique_id && (
              <div className="px-4 pb-3 pt-0">
                <div className="bg-foreground/5 rounded-md p-2.5 space-y-1.5">
                  {test.message && (
                    <div className="text-[10px] text-red-500/80 font-mono whitespace-pre-wrap bg-red-500/5 p-1.5 rounded">
                      {test.message}
                    </div>
                  )}
                  {test.expression && (
                    <div>
                      <span className="text-[9px] text-foreground/40">Expression: </span>
                      <code className="text-[10px] text-foreground/70 font-mono">{test.expression}</code>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-[9px] text-foreground/40">
                    <div>Test type: {test.test_type}</div>
                    {test.model_name && <div>Model: {test.model_name}</div>}
                    {test.column_name && <div>Column: {test.column_name}</div>}
                    <div>Duration: {test.execution_time.toFixed(3)}s</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
