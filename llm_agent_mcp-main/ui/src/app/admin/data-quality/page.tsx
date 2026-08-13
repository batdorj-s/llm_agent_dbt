"use client";

/**
 * Admin Data Quality — dbt test results + custom quality tests.
 * GET /api/data-quality/summary | /tests | /custom-tests (quality:*)
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, Plus, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";

interface QualitySummary {
  available: boolean;
  message?: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  totalTimeSec: number;
  elapsedTime?: number;
  timestamp?: string;
}

interface DbtTestRecord {
  unique_id: string;
  status: string;
  failures: number;
  message: string | null;
  execution_time: number;
  test_name: string;
  test_type: string;
  column_name: string | null;
  model_name: string | null;
  expression: string | null;
}

interface CustomTestRecord {
  id: string;
  name: string;
  model_name: string;
  column_name: string | null;
  test_type: string;
  expression: string | null;
  severity: string;
  description: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

type StatusFilter = "all" | "pass" | "fail" | "error";

export default function AdminDataQualityPage() {
  const { token } = useAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", model_name: "", test_type: "assert_true", severity: "error", expression: "", description: "" });

  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [tests, setTests] = useState<DbtTestRecord[]>([]);
  const [customTests, setCustomTests] = useState<CustomTestRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const authFetch = async (url: string, init: RequestInit = {}) => {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  };

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [s, t, c] = await Promise.all([
        authFetch("/api/data-quality/summary"),
        authFetch("/api/data-quality/tests"),
        authFetch("/api/data-quality/custom-tests"),
      ]);
      setSummary(s.data ?? s);
      setTests(t.data ?? t);
      setCustomTests(c.data ?? c);
      setFormError(null);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Өгөгдөл татахад алдаа гарлаа");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filteredTests = useMemo(() => {
    if (statusFilter === "all") return tests;
    return tests.filter((t) => t.status === statusFilter);
  }, [tests, statusFilter]);

  const isLoading = loading;

  const createTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await authFetch("/api/data-quality/custom-tests", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          model_name: form.model_name.trim(),
          test_type: form.test_type,
          severity: form.severity,
          expression: form.expression.trim() || undefined,
          description: form.description.trim() || undefined,
        }),
      });
      setForm({ name: "", model_name: "", test_type: "assert_true", severity: "error", expression: "", description: "" });
      setShowCreate(false);
      loadAll();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Тест үүсгэхэд алдаа гарлаа");
    } finally {
      setBusy(false);
    }
  };

  const toggleTest = async (t: CustomTestRecord) => {
    setBusy(true);
    try {
      await authFetch(`/api/data-quality/custom-tests/${t.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: !t.is_active }),
      });
      loadAll();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Тест шинэчлэхэд алдаа гарлаа");
    } finally {
      setBusy(false);
    }
  };

  const deleteTest = async (t: CustomTestRecord) => {
    if (!window.confirm(`"${t.name}" тестийг устгах уу?`)) return;
    setBusy(true);
    try {
      await authFetch(`/api/data-quality/custom-tests/${t.id}`, { method: "DELETE" });
      loadAll();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Тест устгахад алдаа гарлаа");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-pulse text-foreground/60 text-sm">Ачааллаж байна...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Өгөгдлийн чанар</h1>
        <p className="text-xs text-foreground/50 mt-1">dbt тестийн үр дүн болон custom quality тестүүд</p>
      </div>

      {summary && !summary.available && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
          <CircleAlert className="w-4 h-4 shrink-0" />
          {summary.message ?? "dbt тестийн үр дүн олдсонгүй. Эхлээд 'dbt test' ажиллуулна уу."}
        </div>
      )}

      {summary?.available && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wider">Нийт тест</span>
                <ShieldCheck className="w-4 h-4 text-foreground/40" />
              </div>
              <div className="text-2xl font-bold text-foreground tabular-nums">{summary.total}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wider">Амжилттай</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-emerald-600 tabular-nums">{summary.passed}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wider">Алдаатай</span>
                <XCircle className="w-4 h-4 text-red-500" />
              </div>
              <div className="text-2xl font-bold text-red-500 tabular-nums">{summary.failed}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wider">Амжилтын түвшин</span>
                <CircleDashed className="w-4 h-4 text-foreground/40" />
              </div>
              <div className="text-2xl font-bold text-foreground tabular-nums">{summary.passRate}%</div>
              <div className="text-[10px] text-foreground/40 mt-1">
                {summary.totalTimeSec}s · {summary.elapsedTime ?? 0}s
              </div>
            </div>
          </div>

          {/* dbt tests */}
          <div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold text-foreground">dbt тестийн үр дүн</h2>
              <div className="flex items-center gap-1">
                {(["all", "pass", "fail", "error"] as StatusFilter[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                      statusFilter === s ? "bg-foreground/10 text-foreground" : "text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5"
                    }`}
                  >
                    {s === "all" ? "Бүгд" : s === "pass" ? "Pass" : s === "fail" ? "Fail" : "Error"}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {filteredTests.length === 0 ? (
                <div className="p-6 text-center text-sm text-foreground/50">Тестийн үр дүн байхгүй</div>
              ) : (
                <ul className="divide-y divide-border">
                  {filteredTests.map((t) => (
                    <li key={t.unique_id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          {t.status === "pass" ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                          )}
                          <span className="text-xs font-medium text-foreground/85 truncate">{t.test_name}</span>
                          <span className="text-[10px] text-foreground/40">{t.test_type}</span>
                        </div>
                        <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-foreground/10 text-foreground/70">
                          {t.status} · {t.execution_time}s
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-foreground/40">
                        {t.model_name && <span className="font-mono">model: {t.model_name}</span>}
                        {t.column_name && <span className="font-mono">column: {t.column_name}</span>}
                        {t.expression && <span className="font-mono">expr: {t.expression}</span>}
                        {t.failures > 0 && <span className="text-red-500/80">failures: {t.failures}</span>}
                      </div>
                      {t.message && <div className="mt-1 text-[10px] text-foreground/50 line-clamp-2">{t.message}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {/* Custom tests */}
      <div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-foreground">Custom тестүүд ({customTests.length})</h2>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium bg-foreground text-background hover:opacity-90 cursor-pointer transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" />
            Шинэ тест
          </button>
        </div>

        {formError && (
          <div className="mb-3 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{formError}</div>
        )}

        {showCreate && (
          <form onSubmit={createTest} className="mb-4 bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-1">Нэр *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  required
                  placeholder="e.g. amount_not_negative"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-1">Model *</label>
                <input
                  value={form.model_name}
                  onChange={(e) => setForm((p) => ({ ...p, model_name: e.target.value }))}
                  required
                  placeholder="e.g. stg_superstore"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-1">Төрөл</label>
                <select
                  value={form.test_type}
                  onChange={(e) => setForm((p) => ({ ...p, test_type: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="assert_true">assert_true</option>
                  <option value="not_null">not_null</option>
                  <option value="unique">unique</option>
                  <option value="expression">expression</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-1">Ноцтой байдал</label>
                <select
                  value={form.severity}
                  onChange={(e) => setForm((p) => ({ ...p, severity: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="error">error</option>
                  <option value="warn">warn</option>
                  <option value="info">info</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-1">Expression</label>
              <input
                value={form.expression}
                onChange={(e) => setForm((p) => ({ ...p, expression: e.target.value }))}
                placeholder="e.g. amount > 0"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-1">Тайлбар</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy}
                className="px-3 py-2 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-opacity"
              >
                {busy ? "Хадгалж байна..." : "Үүсгэх"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                disabled={busy}
                className="px-3 py-2 rounded-lg text-xs text-foreground/60 hover:text-foreground hover:bg-foreground/5 cursor-pointer transition-colors"
              >
                Болих
              </button>
            </div>
          </form>
        )}

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {customTests.length === 0 ? (
            <div className="p-6 text-center text-sm text-foreground/50">Custom тест байхгүй</div>
          ) : (
            <ul className="divide-y divide-border">
              {customTests.map((t) => (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${t.is_active ? "bg-emerald-500" : "bg-foreground/20"}`} />
                      <span className="text-xs font-medium text-foreground/85 truncate">{t.name}</span>
                      <span className="text-[10px] text-foreground/40">@{t.model_name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-foreground/10 text-foreground/70">
                        {t.test_type} · {t.severity}
                      </span>
                      <button
                        onClick={() => toggleTest(t)}
                        disabled={busy}
                        className="px-2 py-1 rounded-md text-[10px] font-medium text-foreground/60 hover:text-foreground hover:bg-foreground/5 disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        {t.is_active ? "Идэвхгүй" : "Идэвхжүүлэх"}
                      </button>
                      <button
                        onClick={() => deleteTest(t)}
                        disabled={busy}
                        className="p-1.5 rounded-md text-foreground/40 hover:text-red-500 hover:bg-red-500/10 disabled:opacity-50 cursor-pointer transition-colors"
                        aria-label={`${t.name} устгах`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {(t.expression || t.description) && (
                    <div className="mt-1 text-[10px] text-foreground/40">
                      {t.expression && <span className="font-mono">{t.expression}</span>}
                      {t.expression && t.description && " · "}
                      {t.description}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}