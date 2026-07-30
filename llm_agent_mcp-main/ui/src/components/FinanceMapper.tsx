"use client";

import React, { useState, useRef } from "react";
import { Upload, CheckCircle, XCircle, Loader2, ArrowLeftRight, Download } from "lucide-react";

interface MappingStep {
  original: string | null;
  target: string;
  note: string;
}

interface MapperResult {
  status: string;
  file_path: string;
  mapping_explanation: MappingStep[];
  preview_data: {
    before: Record<string, unknown>[];
    after: Record<string, unknown>[];
  };
}

type MapperState = "idle" | "uploading" | "done" | "error";

interface FinanceMapperProps {
  token: string;
  onClose?: () => void;
}

export const FinanceMapper: React.FC<FinanceMapperProps> = ({ token, onClose }) => {
  const [state, setState] = useState<MapperState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<MapperResult | null>(null);
  const [error, setError] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file) return;
    setState("uploading");
    setError("");

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/finance-mapper/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (data.status === "success") {
        setResult(data);
        setState("done");
      } else {
        setError(data.error || data.details || "Mapping failed");
        setState("error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setState("error");
    }
  };

  const handleDownload = async () => {
    if (!result) return;
    const filename = result.file_path.split("/").pop();
    if (!filename) return;

    try {
      const response = await fetch(`/api/finance-mapper/download/${filename}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const reset = () => {
    setState("idle");
    setFile(null);
    setResult(null);
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="border-t border-border pt-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block">
          <ArrowLeftRight className="w-3 h-3 inline mr-1" />
          Finance Auto-Mapper
        </span>
        {onClose && (
          <button onClick={onClose} className="text-foreground/50 hover:text-foreground text-[10px] cursor-pointer">✕</button>
        )}
      </div>

      {state === "idle" && (
        <div className="space-y-2">
          <p className="text-[9px] text-foreground/50 leading-relaxed">
            Any CSV/Excel file → sar format (Өдөр, Харилцагч, Дүн, Ангилал, Дэд ангилал, Тайлбар). AI column detection.
          </p>
          <div className="relative border border-dashed border-border hover:border-foreground/30 rounded p-3 text-center transition-colors cursor-pointer bg-background/50 text-foreground">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              required
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <span className="text-[10px] text-foreground/60 block truncate">
              {file ? file.name : "Select CSV or Excel file"}
            </span>
          </div>
          <button
            onClick={handleUpload}
            disabled={!file}
            className="w-full py-1.5 bg-foreground text-background hover:opacity-80 rounded text-[10px] font-bold cursor-pointer transition-all disabled:opacity-30"
          >
            <Upload className="w-3 h-3 inline mr-1" />
            Convert to SAR
          </button>
        </div>
      )}

      {state === "uploading" && (
        <div className="flex flex-col items-center py-4 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-foreground/50" />
          <p className="text-[10px] text-foreground/50">AI is detecting columns & mapping...</p>
        </div>
      )}

      {state === "done" && result && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            <span className="text-[10px] font-bold text-green-600">Mapped successfully!</span>
          </div>
          <div className="text-[9px] text-foreground/50 break-all">{result.file_path}</div>

          <div className="space-y-1">
            <span className="text-[9px] font-bold text-foreground/50 uppercase">Column mapping</span>
            <table className="w-full text-[9px]">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="text-left text-foreground/40 py-1 pr-2">Original</th>
                  <th className="text-left text-foreground/40 py-1 pr-2">→</th>
                  <th className="text-left text-foreground/40 py-1">Target</th>
                </tr>
              </thead>
              <tbody>
                {result.mapping_explanation
                  .filter((m) => m.original)
                  .map((m, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="text-foreground/70 py-1 pr-2">{m.original}</td>
                      <td className="text-foreground/30 py-1 pr-2">→</td>
                      <td className="text-foreground py-1">{m.target}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {result.preview_data.after.length > 0 && (
            <div className="space-y-1">
              <span className="text-[9px] font-bold text-foreground/50 uppercase">Preview ({result.preview_data.after.length} rows)</span>
              <div className="overflow-x-auto max-h-24 bg-background/50 rounded border border-border/60 p-1">
                <table className="text-[8px] w-full">
                  <thead>
                    <tr className="border-b border-border/40">
                      {Object.keys(result.preview_data.after[0]).map((k) => (
                        <th key={k} className="text-left text-foreground/50 font-bold px-1 py-0.5 whitespace-nowrap">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.preview_data.after.slice(0, 3).map((row, ri) => (
                      <tr key={ri} className="border-b border-border/20">
                        {Object.values(row).map((v, ci) => (
                          <td key={ci} className="text-foreground/70 px-1 py-0.5 whitespace-nowrap">{String(v ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleDownload}
              className="flex-1 py-1.5 bg-foreground text-background hover:opacity-80 rounded text-[10px] font-bold cursor-pointer transition-all"
            >
              <Download className="w-3 h-3 inline mr-1" />
              Download
            </button>
            <button
              onClick={reset}
              className="flex-1 py-1.5 bg-background border border-border hover:bg-foreground/5 text-foreground rounded text-[10px] font-bold cursor-pointer transition-colors"
            >
              Map another file
            </button>
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5 text-red-500" />
            <span className="text-[10px] font-bold text-red-500">Mapping failed</span>
          </div>
          <p className="text-[9px] text-red-400/80 break-words">{error}</p>
          <button
            onClick={reset}
            className="w-full py-1.5 bg-background border border-border hover:bg-foreground/5 text-foreground rounded text-[10px] font-bold cursor-pointer transition-colors"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
};
