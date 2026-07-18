"use client";

import React, { useState, useCallback } from "react";
import { Download, FileText, FileSpreadsheet, ImageIcon, Check } from "lucide-react";

interface ExportButtonProps {
  token: string;
  dashboardContainerId?: string;
}

export function ExportButton({ token, dashboardContainerId }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [exported, setExported] = useState<"csv" | "json" | "png" | null>(null);

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

  const handleExportPng = useCallback(async () => {
    try {
      const html2canvas = (await import("html2canvas")).default;
      const el = dashboardContainerId
        ? document.getElementById(dashboardContainerId)
        : document.querySelector('[data-dashboard-export]') as HTMLElement | null;
      if (!el) throw new Error("Dashboard container not found");

      const canvas = await html2canvas(el, {
        backgroundColor: getComputedStyle(el).backgroundColor || "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });

      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `dashboard_${new Date().toISOString().split("T")[0]}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });

      setExported("png");
      setTimeout(() => setExported(null), 2000);
    } catch (err) {
      console.error("Dashboard PNG export failed:", err);
    }
  }, [dashboardContainerId]);

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
              {dashboardContainerId && (
                <button onClick={() => { handleExportPng(); setIsOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg hover:bg-foreground/5 transition-colors cursor-pointer">
                  {exported === "png" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <ImageIcon className="w-3.5 h-3.5 text-foreground/50" />}
                  <span>Зураг (PNG)</span>
                </button>
              )}
              <button onClick={() => { handleExport("csv"); setIsOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg hover:bg-foreground/5 transition-colors cursor-pointer">
                {exported === "csv" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <FileText className="w-3.5 h-3.5 text-foreground/50" />}
                <span>CSV татах</span>
              </button>
              <button onClick={() => { handleExport("json"); setIsOpen(false); }}
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
