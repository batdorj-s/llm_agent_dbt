"use client";

import React, { useState, useEffect } from "react";
import { Bell, X, AlertTriangle, AlertCircle, Info } from "lucide-react";

interface Alert {
  id: string;
  type: "critical" | "warning" | "info";
  category: string;
  message: string;
  value: number | string;
  threshold: string;
  detectedAt: string;
}

interface AlertBellProps {
  token: string;
}

const TYPE_STYLES: Record<Alert["type"], { icon: React.ReactNode; bg: string; border: string; text: string }> = {
  critical: { icon: <AlertCircle className="w-3.5 h-3.5" />, bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-500" },
  warning: { icon: <AlertTriangle className="w-3.5 h-3.5" />, bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-500" },
  info: { icon: <Info className="w-3.5 h-3.5" />, bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-500" },
};

export function AlertBell({ token }: AlertBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/alerts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setAlerts(data.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  // Auto-fetch on mount
  useEffect(() => { fetchAlerts(); }, []);

  const criticalCount = alerts.filter(a => a.type === "critical").length;
  const warningCount = alerts.filter(a => a.type === "warning").length;
  const hasAlerts = alerts.length > 0;

  return (
    <div className="relative">
      <button
        onClick={() => { setIsOpen(!isOpen); if (!isOpen) fetchAlerts(); }}
        className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition-all cursor-pointer ${
          hasAlerts
            ? "border-amber-500/30 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
            : "border-border bg-card text-foreground/60 hover:bg-foreground/5"
        }`}>
        <Bell className={`w-3.5 h-3.5 ${loading ? "animate-pulse" : ""}`} />
        <span className="hidden sm:inline">Сэрэмжлүүлэг</span>
        {hasAlerts && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-amber-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {alerts.length}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-80 max-h-96 overflow-y-auto rounded-xl border border-border bg-card shadow-2xl animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-medium">Сэрэмжлүүлэг ({alerts.length})</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-foreground/40 hover:text-foreground/80 cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Summary */}
            {hasAlerts && (
              <div className="flex gap-3 px-4 py-2 border-b border-border/50 bg-background/50">
                {criticalCount > 0 && (
                  <span className="flex items-center gap-1 text-[10px] text-red-500">
                    <AlertCircle className="w-3 h-3" /> {criticalCount} ноцтой
                  </span>
                )}
                {warningCount > 0 && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-500">
                    <AlertTriangle className="w-3 h-3" /> {warningCount} анхааруулга
                  </span>
                )}
              </div>
            )}

            {/* Alert List */}
            <div className="p-2 space-y-1.5">
              {alerts.length === 0 ? (
                <p className="text-center text-xs text-foreground/40 py-6">
                  {loading ? "Шалгаж байна..." : "Сэрэмжлүүлэг байхгүй"}
                </p>
              ) : (
                alerts.map(alert => {
                  const style = TYPE_STYLES[alert.type];
                  return (
                    <div key={alert.id} className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${style.bg} ${style.border}`}>
                      <div className={`mt-0.5 ${style.text}`}>{style.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-foreground/40">{alert.category}</p>
                        <p className="text-xs text-foreground/80 leading-tight">{alert.message}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
