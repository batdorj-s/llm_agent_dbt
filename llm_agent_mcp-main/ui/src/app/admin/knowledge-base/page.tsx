"use client";

/**
 * Admin Knowledge Base — RAG documents list with search/filters + delete.
 * GET /api/admin/documents, GET /api/admin/documents/categories.
 */

import React, { useState } from "react";
import { useList, useCustom, useDelete } from "@refinedev/core";
import { Search, FileText, Trash2, Tag, Building2, Upload, X } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";

interface DocumentRecord {
  id: string;
  category: string | null;
  department: string | null;
  author: string | null;
  source_name: string | null;
  parent_doc_id: string | null;
  chunk_index: number | null;
  shared: boolean | null;
  keywords: string[] | null;
  uploaded_at: string;
  text_length: number;
  text_preview: string;
}

type UploadKind = "csv" | "excel";

export default function AdminKnowledgeBasePage() {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [department, setDepartment] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadKind, setUploadKind] = useState<UploadKind>("csv");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [tableName, setTableName] = useState("");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const limit = 100;

  const { query } = useList<DocumentRecord>({
    resource: "documents",
    filters: [
      ...(search ? [{ field: "search", operator: "eq" as const, value: search }] : []),
      ...(category ? [{ field: "category", operator: "eq" as const, value: category }] : []),
      ...(department ? [{ field: "department", operator: "eq" as const, value: department }] : []),
    ],
    pagination: { currentPage: 1, pageSize: limit },
  });

  const { query: filterQuery } = useCustom<{ categories: string[]; departments: string[] }>({
    url: "/api/admin/documents/categories",
    method: "get",
  });

  const { mutate: deleteDocument } = useDelete();

  const docs = query.data?.data ?? [];
  const isLoading = query.isLoading;
  const isError = query.isError;
  const refetch = query.refetch;
  const total = query.data?.total ?? 0;

  const categories = filterQuery.data?.data?.categories ?? [];
  const departments = filterQuery.data?.data?.departments ?? [];

  const handleDelete = (doc: DocumentRecord) => {
    if (!window.confirm(`Баримтын хэсэг "${doc.id}" болон түүний дэд хэсгүүдийг устгах уу?`)) return;
    deleteDocument({ resource: "documents", id: doc.id }, { onSuccess: () => refetch() });
  };

  const closeUpload = () => {
    setUploadOpen(false);
    setUploadFile(null);
    setTableName("");
    setDescription("");
    setUploadError(null);
    setUploadSuccess(null);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !tableName.trim() || !description.trim()) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("tableName", tableName.trim());
      fd.append("description", description.trim());
      const res = await fetch(uploadKind === "csv" ? "/api/admin/upload-csv" : "/api/admin/upload-excel", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setUploadSuccess(body.message ?? "Амжилттай импортлогдлоо");
      refetch();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Хуулахад алдаа гарлаа");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Мэдлэгийн сан</h1>
          <p className="text-xs text-foreground/50 mt-1">
            RAG баримтууд — нийт {total.toLocaleString()} хэсэг
          </p>
        </div>
        <button
          onClick={() => setUploadOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-foreground text-background hover:opacity-90 cursor-pointer transition-opacity"
        >
          <Upload className="w-3.5 h-3.5" />
          Шинэ мэдээлэл хуулах
        </button>
      </div>

      {/* Upload modal */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeUpload}>
          <form
            onSubmit={handleUpload}
            onClick={(ev) => ev.stopPropagation()}
            className="w-full max-w-md bg-card border border-border rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground">Шинэ мэдээлэл хуулах</h2>
              <button
                type="button"
                onClick={closeUpload}
                className="p-1.5 rounded-md text-foreground/40 hover:text-foreground hover:bg-foreground/5 cursor-pointer transition-colors"
                aria-label="Хаах"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-1">Файлын төрөл</label>
              <div className="flex gap-2">
                {(["csv", "excel"] as UploadKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setUploadKind(k)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                      uploadKind === k ? "bg-foreground/10 text-foreground" : "text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5"
                    }`}
                  >
                    {k === "csv" ? "CSV" : "Excel"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-1">Файл *</label>
              <input
                type="file"
                accept={uploadKind === "csv" ? ".csv" : ".xlsx,.xls"}
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs text-foreground file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-foreground/10 file:text-foreground file:text-xs file:font-medium file:cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-1">Хүснэгтийн нэр *</label>
              <input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                required
                placeholder="e.g. sales_2024 (латин үсэг, тоо, _)"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-foreground/50 uppercase tracking-wider mb-1">Тайлбар *</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={2}
                placeholder="Энэ өгөгдлийн тайлбар, агуулга..."
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {uploadError && (
              <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{uploadError}</div>
            )}
            {uploadSuccess && (
              <div className="text-xs text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{uploadSuccess}</div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeUpload}
                disabled={uploading}
                className="px-3 py-2 rounded-lg text-xs text-foreground/60 hover:text-foreground hover:bg-foreground/5 disabled:opacity-50 cursor-pointer transition-colors"
              >
                Болих
              </button>
              <button
                type="submit"
                disabled={uploading || !uploadFile || !tableName.trim() || !description.trim()}
                className="px-3 py-2 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-opacity"
              >
                {uploading ? "Импортлож байна..." : "Хуулах"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Агуулга, ID, эх сурвалжаар хайх..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex gap-3">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Бүх ангилал</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Бүх хэлтэс</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading && (
          <div className="p-8 text-center text-sm text-foreground/50 animate-pulse">Ачааллаж байна...</div>
        )}
        {isError && (
          <div className="p-8 text-center text-sm text-red-500">Баримтын жагсаалтыг ачаалахад алдаа гарлаа</div>
        )}
        {!isLoading && !isError && docs.length === 0 && (
          <div className="p-8 text-center text-sm text-foreground/50">Баримт олдсонгүй</div>
        )}
        {!isLoading && !isError && docs.length > 0 && (
          <ul className="divide-y divide-border">
            {docs.map((doc) => (
              <li key={doc.id} className="px-4 py-3.5 hover:bg-foreground/[0.02] flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
                  <FileText className="w-4 h-4 text-foreground/60" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-foreground/40 truncate">{doc.id}</span>
                    {doc.parent_doc_id ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/40">
                        chunk {doc.chunk_index ?? "?"}
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 font-medium">
                        эх баримт
                      </span>
                    )}
                    {doc.shared && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-medium">
                        shared
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-foreground/70 mt-1.5 line-clamp-2">{doc.text_preview}...</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-foreground/40 flex-wrap">
                    {doc.category && (
                      <span className="flex items-center gap-1">
                        <Tag className="w-3 h-3" /> {doc.category}
                      </span>
                    )}
                    {doc.department && (
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> {doc.department}
                      </span>
                    )}
                    {doc.source_name && <span className="truncate max-w-40">{doc.source_name}</span>}
                    <span>{doc.text_length.toLocaleString()} тэмдэгт</span>
                    <span>{new Date(doc.uploaded_at).toLocaleDateString("mn-MN")}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(doc)}
                  className="p-2 rounded-md text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors shrink-0"
                  title="Устгах"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}