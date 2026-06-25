"use client";

import React from "react";
import { Activity, FileText, Trash2 } from "lucide-react";
import { UploadedFile } from "./types";

interface AdminPanelProps {
  user: { email: string; role: string } | null;
  adjustMetric: "sales" | "users" | "churn_rate";
  newTargetValue: number;
  isUpdatingTarget: boolean;
  salesUpdateSuccess: string | null;
  csvFile: File | null;
  tableNameInput: string;
  tableDescInput: string;
  isUploadingCsv: boolean;
  csvUploadMessage: string | null;
  excelFile: File | null;
  excelTableNameInput: string;
  excelDescInput: string;
  isUploadingExcel: boolean;
  excelUploadMessage: string | null;
  docFile: File | null;
  docDescInput: string;
  isUploadingDoc: boolean;
  docUploadMessage: string | null;
  uploadedFiles: UploadedFile[];
  onAdjustMetricChange: (val: "sales" | "users" | "churn_rate") => void;
  onNewTargetValueChange: (val: number) => void;
  onUpdateKpiTarget: () => void;
  onCsvFileChange: (file: File | null) => void;
  onTableNameInputChange: (val: string) => void;
  onTableDescInputChange: (val: string) => void;
  onUploadCsv: (e: React.FormEvent) => void;
  onExcelFileChange: (file: File | null) => void;
  onExcelTableNameInputChange: (val: string) => void;
  onExcelDescInputChange: (val: string) => void;
  onUploadExcel: (e: React.FormEvent) => void;
  onDocFileChange: (file: File | null) => void;
  onDocDescInputChange: (val: string) => void;
  onUploadDoc: (e: React.FormEvent) => void;
  onViewFile: (file: UploadedFile) => void;
  onDeleteFile: (id: string) => void;
}

export const AdminPanel = ({
  user,
  adjustMetric,
  newTargetValue,
  isUpdatingTarget,
  salesUpdateSuccess,
  csvFile,
  tableNameInput,
  tableDescInput,
  isUploadingCsv,
  csvUploadMessage,
  excelFile,
  excelTableNameInput,
  excelDescInput,
  isUploadingExcel,
  excelUploadMessage,
  docFile,
  docDescInput,
  isUploadingDoc,
  docUploadMessage,
  uploadedFiles,
  onAdjustMetricChange,
  onNewTargetValueChange,
  onUpdateKpiTarget,
  onCsvFileChange,
  onTableNameInputChange,
  onTableDescInputChange,
  onUploadCsv,
  onExcelFileChange,
  onExcelTableNameInputChange,
  onExcelDescInputChange,
  onUploadExcel,
  onDocFileChange,
  onDocDescInputChange,
  onUploadDoc,
  onViewFile,
  onDeleteFile,
}: AdminPanelProps) => {
  if (!user) return null;

  return (
    <div className="border-t border-border pt-5 space-y-4">
      {/* TARGET MANAGER */}
      <div className="space-y-2.5">
        <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">Target Manager</span>
        <div className="flex gap-2">
          <select
            value={adjustMetric}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onAdjustMetricChange(e.target.value as "sales" | "users" | "churn_rate")}
            className="flex-1 bg-background border border-border rounded px-2 py-1 text-[10px] text-foreground focus:outline-none focus:border-foreground/30"
          >
            <option value="sales">Sales</option>
            <option value="users">Users</option>
            <option value="churn_rate">Churn</option>
          </select>
          <input
            type="number"
            value={newTargetValue}
            onChange={(e) => onNewTargetValueChange(Number(e.target.value))}
            className="w-16 bg-background border border-border rounded px-2 py-1 text-center text-[10px] text-foreground focus:outline-none focus:border-foreground/30"
          />
        </div>
        <button
          onClick={onUpdateKpiTarget}
          disabled={isUpdatingTarget}
          className="w-full py-1.5 bg-background border border-border hover:bg-foreground/5 text-foreground rounded text-[10px] font-bold cursor-pointer transition-colors duration-150"
        >
          Update Target
        </button>
        {salesUpdateSuccess && (
          <p className="text-[9px] text-center text-emerald-600 dark:text-emerald-450">{salesUpdateSuccess}</p>
        )}
      </div>

      {/* CSV UPLOADER */}
      <div className="border-t border-border pt-4 space-y-2">
        <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">Upload Dataset (CSV)</span>
        <form onSubmit={onUploadCsv} className="space-y-2">
          <input type="text" required placeholder="Table name (e.g. branch_sales)" value={tableNameInput} onChange={(e) => onTableNameInputChange(e.target.value)}
            className="w-full bg-background border border-border rounded p-1.5 text-[10px] text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors" />
          <input type="text" required placeholder="Description of data..." value={tableDescInput} onChange={(e) => onTableDescInputChange(e.target.value)}
            className="w-full bg-background border border-border rounded p-1.5 text-[10px] text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors" />
          <div className="relative border border-dashed border-border hover:border-foreground/30 rounded p-3 text-center transition-colors cursor-pointer bg-background/50 text-foreground">
            <input type="file" accept=".csv" required onChange={(e) => onCsvFileChange(e.target.files?.[0] || null)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            <span className="text-[10px] text-foreground/60 block truncate">{csvFile ? csvFile.name : "Select CSV file"}</span>
          </div>
          <button type="submit" disabled={isUploadingCsv || !csvFile || !tableNameInput.trim() || !tableDescInput.trim()}
            className="w-full py-1.5 bg-background border border-border hover:bg-foreground/5 text-foreground rounded text-[10px] font-bold cursor-pointer transition-colors disabled:opacity-50 duration-150">
            {isUploadingCsv ? "Uploading..." : "Upload & Index"}
          </button>
        </form>
        {csvUploadMessage && <p className="text-[9px] text-foreground/60 mt-1 max-w-full break-words">{csvUploadMessage}</p>}
      </div>

      {/* EXCEL UPLOADER */}
      <div className="border-t border-border pt-4 space-y-2">
        <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">Upload Excel (XLSX/XLS)</span>
        <form onSubmit={onUploadExcel} className="space-y-2">
          <input type="text" required placeholder="Table name..." value={excelTableNameInput} onChange={(e) => onExcelTableNameInputChange(e.target.value)}
            className="w-full bg-background border border-border rounded p-1.5 text-[10px] text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors" />
          <input type="text" required placeholder="Description..." value={excelDescInput} onChange={(e) => onExcelDescInputChange(e.target.value)}
            className="w-full bg-background border border-border rounded p-1.5 text-[10px] text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors" />
          <div className="relative border border-dashed border-border hover:border-foreground/30 rounded p-3 text-center transition-colors cursor-pointer bg-background/50 text-foreground">
            <input type="file" accept=".xlsx,.xls" required onChange={(e) => onExcelFileChange(e.target.files?.[0] || null)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            <span className="text-[10px] text-foreground/60 block truncate">{excelFile ? excelFile.name : "Select Excel file"}</span>
          </div>
          <button type="submit" disabled={isUploadingExcel || !excelFile || !excelTableNameInput.trim() || !excelDescInput.trim()}
            className="w-full py-1.5 bg-background border border-border hover:bg-foreground/5 text-foreground rounded text-[10px] font-bold cursor-pointer transition-colors disabled:opacity-50 duration-150">
            {isUploadingExcel ? "Uploading..." : "Upload & Index"}
          </button>
        </form>
        {excelUploadMessage && <p className="text-[9px] text-foreground/60 mt-1 max-w-full break-words">{excelUploadMessage}</p>}
      </div>

      {/* DOCUMENT UPLOADER */}
      <div className="border-t border-border pt-4 space-y-2">
        <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">Upload Document (PDF/DOCX)</span>
        <form onSubmit={onUploadDoc} className="space-y-2">
          <input type="text" required placeholder="Brief description..." value={docDescInput} onChange={(e) => onDocDescInputChange(e.target.value)}
            className="w-full bg-background border border-border rounded p-1.5 text-[10px] text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors" />
          <div className="relative border border-dashed border-border hover:border-foreground/30 rounded p-3 text-center transition-colors cursor-pointer bg-background/50 text-foreground">
            <input type="file" accept=".pdf,.docx" required onChange={(e) => onDocFileChange(e.target.files?.[0] || null)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            <span className="text-[10px] text-foreground/60 block truncate">{docFile ? docFile.name : "Select PDF or Word file"}</span>
          </div>
          <button type="submit" disabled={isUploadingDoc || !docFile || !docDescInput.trim()}
            className="w-full py-1.5 bg-background border border-border hover:bg-foreground/5 text-foreground rounded text-[10px] font-bold cursor-pointer transition-colors disabled:opacity-50 duration-150">
            {isUploadingDoc ? "Indexing..." : "Index Document"}
          </button>
        </form>
        {docUploadMessage && <p className="text-[9px] text-foreground/60 mt-1 max-w-full break-words">{docUploadMessage}</p>}
      </div>

      {/* FILE MANAGER */}
      <div className="border-t border-border pt-4 space-y-2">
        <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">Uploaded Assets</span>
        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
          {uploadedFiles.length === 0 ? (
            <p className="text-[9px] text-foreground/45 italic">No assets uploaded yet.</p>
          ) : (
            uploadedFiles.map((f, fi) => (
              <div key={f.id} onClick={() => onViewFile(f)} className="group flex items-center justify-between bg-background border border-border/80 hover:border-foreground/20 rounded px-2 py-1.5 transition-colors cursor-pointer animate-fade-in-up" style={{ animationDelay: `${fi * 40}ms` }}>
                <div className="flex items-center gap-2 overflow-hidden">
                  {f.type === "dataset" ? <Activity className="w-3 h-3 text-foreground/60 shrink-0" /> : <FileText className="w-3 h-3 text-foreground/60 shrink-0" />}
                  <span className="text-[10px] text-foreground/70 truncate" title={f.description || f.filename}>
                    {f.filename.length > 15 ? f.filename.substring(0, 12) + "..." : f.filename}
                  </span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); onDeleteFile(f.id); }}
                  className="text-foreground/45 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all cursor-pointer" title="Delete Asset">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
