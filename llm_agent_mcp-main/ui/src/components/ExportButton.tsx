"use client";

import React, { useState } from "react";
import { Download, FileText, FileSpreadsheet, Check } from "lucide-react";

interface ExportButtonProps {
  token: string;
}

export function ExportButton({ token }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [exported, setExported] = useState<"csv" | "json" | null>(null);

  const handleExport = async (format: "csv" | "json") => {
    try {
      const res = await fetch(`/api/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export_${new Date().toISOString().split("T")[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setExported(format);
      setTimeout(() => setExported(null), 2000);
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  return (
    <div className="relative">
      <button onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border bg-card text-foreground/60 rounded-lg hover:bg-foreground/5 transition-all cursor-pointer">
        <Download className="w-3.5 h-3.5" />
        Татах
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-48 rounded-xl border border-border bg-card shadow-2xl animate-fade-in">
            <div className="p-1.5">
              <button onClick={() => handleExport("csv")}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg hover:bg-foreground/5 transition-colors cursor-pointer">
                {exported === "csv" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <FileText className="w-3.5 h-3.5 text-foreground/50" />}
                <span>CSV татах</span>
              </button>
              <button onClick={() => handleExport("json")}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg hover:bg-foreground/5 transition-colors cursor-pointer">
                {exported === "json" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-foreground/50" />}
                <span>JSON татах</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
