"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Calendar, Plus, Trash2, Clock, Play, Pause } from "lucide-react";

interface ScheduledReport {
  id: string;
  name: string;
  description: string;
  query: string;
  format: string;
  cron_expression: string;
  recipients: string[];
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export function ReportScheduler({ token }: { token: string | null }) {
  const [reports, setReports] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", query: "", cron_expression: "0 8 * * 1", format: "pdf" });
  const [error, setError] = useState("");

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scheduler/reports", { headers });
      const d = await res.json();
      if (d.success) setReports(d.data);
    } catch { setError("Тайлангууд татахад алдаа гарлаа."); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchReports(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/scheduler/reports", {
        method: "POST",
        headers,
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (d.success) {
        setShowForm(false);
        setForm({ name: "", query: "", cron_expression: "0 8 * * 1", format: "pdf" });
        fetchReports();
      } else {
        setError(d.error || "Failed to create");
      }
    } catch { setError("Network error"); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Устгах уу?")) return;
    try {
      await fetch(`/api/scheduler/reports/${id}`, { method: "DELETE", headers });
      setError("");
      fetchReports();
    } catch { setError("Тайлан устгахад алдаа гарлаа."); }
  };

  const handleToggle = async (report: ScheduledReport) => {
    try {
      await fetch(`/api/scheduler/reports/${report.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ is_active: !report.is_active }),
      });
      setError("");
      fetchReports();
    } catch { setError("Төлөв өөрчлөхөд алдаа гарлаа."); }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Calendar className="w-4 h-4 text-foreground/70" />
        <span className="text-xs font-semibold text-foreground">Тайлангийн хуваарь</span>
        <button
          onClick={() => setShowForm(!showForm)}
          className="ml-auto flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md bg-blue-500/20 text-blue-600 dark:text-blue-400 hover:bg-blue-500/30 transition-colors cursor-pointer"
        >
          <Plus className="w-3 h-3" />
          Шинэ хуваарь
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="px-4 py-3 border-b border-border bg-foreground/5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text" placeholder="Нэр" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="col-span-2 px-2 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
            <input
              type="text" placeholder="SQL Query" value={form.query}
              onChange={(e) => setForm((f) => ({ ...f, query: e.target.value }))}
              className="col-span-2 px-2 py-1.5 text-xs font-mono rounded-md border border-border bg-background text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
            <div className="flex items-center gap-1 text-[9px] text-foreground/40 px-1">
              <Clock className="w-2.5 h-2.5" />
              Cron (5-field)
            </div>
            <input
              type="text" placeholder="0 8 * * 1" value={form.cron_expression}
              onChange={(e) => setForm((f) => ({ ...f, cron_expression: e.target.value }))}
              className="px-2 py-1.5 text-xs font-mono rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
            <select
              value={form.format}
              onChange={(e) => setForm((f) => ({ ...f, format: e.target.value }))}
              className="px-2 py-1.5 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="pdf">PDF</option>
              <option value="xlsx">XLSX</option>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </div>
          {error && <div className="text-[10px] text-red-500">{error}</div>}
          <div className="flex gap-2">
            <button type="submit" className="px-3 py-1 text-[10px] font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer">Үүсгэх</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1 text-[10px] text-foreground/50 hover:text-foreground/80 cursor-pointer">Цуцлах</button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex items-center justify-center py-12 text-foreground/30 text-xs animate-pulse">Ачаалж байна...</div>}

        {!loading && reports.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-foreground/40">
            <Calendar className="w-8 h-8 mb-2 opacity-30" />
            <div className="text-xs">Хуваарьтай тайлан байхгүй</div>
            <button onClick={() => setShowForm(true)} className="mt-2 text-[10px] text-blue-500 hover:text-blue-400 cursor-pointer">Шинэ хуваарь үүсгэх</button>
          </div>
        )}

        {reports.map((report) => (
          <div key={report.id} className="border-b border-border/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleToggle(report)}
                className={`p-1 rounded cursor-pointer transition-colors ${report.is_active ? "text-emerald-500 hover:text-emerald-400" : "text-foreground/30 hover:text-foreground/50"}`}
                title={report.is_active ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
              >
                {report.is_active ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${report.is_active ? "text-foreground" : "text-foreground/40"}`}>{report.name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-foreground/5 text-foreground/40 uppercase">{report.format}</span>
                  {!report.is_active && <span className="text-[9px] text-foreground/30">(зогссон)</span>}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[9px] text-foreground/40">
                  <span>{report.cron_expression}</span>
                  {report.next_run_at && <span>Дараагийн: {new Date(report.next_run_at).toLocaleDateString("mn-MN")}</span>}
                  {report.last_run_at && <span>Сүүлд: {new Date(report.last_run_at).toLocaleDateString("mn-MN")}</span>}
                </div>
                {report.description && <div className="text-[9px] text-foreground/30 mt-0.5">{report.description}</div>}
              </div>

              <button onClick={() => handleDelete(report.id)} className="p-1 text-foreground/30 hover:text-red-500 transition-colors cursor-pointer" title="Устгах">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
