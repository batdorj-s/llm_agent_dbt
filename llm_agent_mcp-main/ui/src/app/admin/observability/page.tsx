"use client";

/**
 * Admin Observability — platform health: SQL logs + pending feedback.
 * Uses GET /api/admin/summary (admin:system).
 */

import React, { useState } from "react";
import { useCustom } from "@refinedev/core";
import { Activity, Check, CheckCircle2, Clock, MessageSquare, X, XCircle } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";

interface SqlLogRecord {
  id: string;
  user_id: string;
  query: string;
  outcome: string;
  attempts: number;
  table_name: string | null;
  error: string | null;
  duration_ms: number;
  created_at: string;
}

interface FeedbackRecord {
  id: string;
  message: string;
  rating: number | null;
  createdAt: string;
}

interface SummaryData {
  counts: Record<string, number>;
  recentSqlLogs: SqlLogRecord[];
  recentFeedback: FeedbackRecord[];
}

export default function AdminObservabilityPage() {
  const { token } = useAuth();
  const { query, result } = useCustom<SummaryData>({
    url: "/api/admin/summary",
    method: "get",
  });

  const [actionId, setActionId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const data = result.data;
  const counts = data?.counts;
  const logs = data?.recentSqlLogs ?? [];
  const feedback = data?.recentFeedback ?? [];
  const isLoading = query.isLoading;
  const isError = query.isError;

  const submitFeedback = async (id: string, decision: "approve" | "reject", correctAnswer?: string) => {
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/feedback/${id}/${decision}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(correctAnswer ? { correctAnswer } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setActionId(null);
      setAnswerText("");
      query.refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Үйлдэл амжилтгүй боллоо");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-pulse text-foreground/60 text-sm">Ачааллаж байна...</div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-foreground/50 text-sm">
        Summary ачаалахад алдаа гарлаа
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Хяналт</h1>
        <p className="text-xs text-foreground/50 mt-1">SQL шинжилгээний лог болон хэрэглэгчийн санал хүсэлт</p>
      </div>

      {/* SQL stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Нийт SQL" value={counts?.sqlLogs ?? 0} icon={<Activity className="w-4 h-4" />} />
        <StatCard label="Амжилттай" value={counts?.sqlSucceeded ?? 0} icon={<CheckCircle2 className="w-4 h-4" />} accent="text-emerald-600" />
        <StatCard label="Алдаатай" value={counts?.sqlFailed ?? 0} icon={<XCircle className="w-4 h-4" />} accent="text-red-500" />
        <StatCard label="Сүүлийн 24ц" value={counts?.sqlLast24h ?? 0} icon={<Clock className="w-4 h-4" />} />
      </div>

      {/* Recent SQL logs */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Сүүлийн SQL асуулгууд</h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {logs.length === 0 ? (
            <div className="p-6 text-center text-sm text-foreground/50">Лог байхгүй</div>
          ) : (
            <ul className="divide-y divide-border">
              {logs.map((log) => (
                <li key={log.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <code className="text-xs text-foreground/80 font-mono truncate">{log.query}</code>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        log.outcome === "success"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-red-500/10 text-red-500"
                      }`}
                    >
                      {log.outcome === "success" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {log.outcome}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-foreground/40">
                    <span className="font-mono">{log.id}</span>
                    <span>{log.duration_ms}ms</span>
                    {log.table_name && <span>{log.table_name}</span>}
                    {log.error && <span className="text-red-500/70 truncate">{log.error}</span>}
                    <span className="ml-auto">{new Date(log.created_at).toLocaleString("mn-MN")}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Pending feedback */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">
          Хүлээгдэж буй санал хүсэлт ({counts?.feedbackPending ?? 0})
        </h2>
        {actionError && (
          <div className="mb-3 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {actionError}
          </div>
        )}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {feedback.length === 0 ? (
            <div className="p-6 text-center text-sm text-foreground/50">Санал хүсэлт байхгүй</div>
          ) : (
            <ul className="divide-y divide-border">
              {feedback.map((f) => (
                <li key={String(f.id)} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
                      <span className="text-xs text-foreground/80 line-clamp-2">{String(f.message)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => {
                          setActionError(null);
                          setAnswerText("");
                          setActionId(actionId === String(f.id) ? null : String(f.id));
                        }}
                        disabled={submitting}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Зөвшөөрөх
                      </button>
                      <button
                        onClick={() => {
                          if (!window.confirm("Энэ саналыг reject хийх үү?")) return;
                          submitFeedback(String(f.id), "reject");
                        }}
                        disabled={submitting}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        Reject
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-foreground/40">
                    {f.rating != null && <span>Үнэлгээ: {f.rating}/5</span>}
                    <span className="ml-auto">{new Date(String(f.createdAt)).toLocaleString("mn-MN")}</span>
                  </div>
                  {actionId === String(f.id) && (
                    <div className="mt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <input
                        value={answerText}
                        onChange={(e) => setAnswerText(e.target.value)}
                        placeholder="Зөв хариулт (заавал биш) — approve хийхэд RAG-д нэмэгдэнэ"
                        className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => submitFeedback(String(f.id), "approve", answerText.trim() || undefined)}
                          disabled={submitting}
                          className="px-3 py-2 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-opacity"
                        >
                          {submitting ? "Хүлээх..." : "Баталгаажуулах"}
                        </button>
                        <button
                          onClick={() => setActionId(null)}
                          disabled={submitting}
                          className="px-3 py-2 rounded-lg text-xs text-foreground/60 hover:text-foreground hover:bg-foreground/5 cursor-pointer transition-colors"
                        >
                          Болих
                        </button>
                      </div>
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

function StatCard({
  label,
  value,
  icon,
  accent = "",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wider">{label}</span>
        <span className={accent}>{icon}</span>
      </div>
      <div className="text-2xl font-bold text-foreground tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}