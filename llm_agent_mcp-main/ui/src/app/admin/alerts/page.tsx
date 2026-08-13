"use client";

/**
 * Admin Alerts — automated data quality alerts from the active catalog table.
 * GET /api/alerts (alert:read)
 */

import React from "react";
import { useCustom } from "@refinedev/core";
import { Bell, CircleAlert, Info, TriangleAlert } from "lucide-react";

interface AlertRecord {
  id: string;
  type: "critical" | "warning" | "info";
  category: string;
  message: string;
  value: number | string;
  threshold: string;
  detectedAt: string;
}

const TYPE_STYLES: Record<AlertRecord["type"], { badge: string; icon: React.ReactNode }> = {
  critical: { badge: "bg-red-500/10 text-red-500", icon: <CircleAlert className="w-4 h-4" /> },
  warning: { badge: "bg-amber-500/10 text-amber-600", icon: <TriangleAlert className="w-4 h-4" /> },
  info: { badge: "bg-sky-500/10 text-sky-600", icon: <Info className="w-4 h-4" /> },
};

export default function AdminAlertsPage() {
  const { query, result } = useCustom<AlertRecord[]>({
    url: "/api/alerts",
    method: "get",
  });

  const alerts = result.data ?? [];

  if (query.isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-pulse text-foreground/60 text-sm">Ачааллаж байна...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Сануулга</h1>
        <p className="text-xs text-foreground/50 mt-1">Идэвхтэй catalog хүснэгтийн автомат шалгалтын сануулгууд</p>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {alerts.length === 0 ? (
          <div className="p-10 text-center">
            <Bell className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
            <div className="text-sm text-foreground/60">Одоогоор сануулга байхгүй</div>
            <p className="text-xs text-foreground/40 mt-1">
              Сануулга нь идэвхтэй catalog хүснэгтийн өгөгдөлд автомат шалгалт хийж үүсгэгдэнэ
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((a) => {
              const style = TYPE_STYLES[a.type];
              return (
                <li key={a.id} className="px-4 py-3 flex items-start gap-3">
                  <span className={`shrink-0 mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-lg ${style.badge}`}>
                    {style.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground/85">{a.category}</span>
                      <span className="text-[10px] uppercase tracking-wider text-foreground/40">{a.type}</span>
                    </div>
                    <div className="text-xs text-foreground/70 mt-0.5">{a.message}</div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-foreground/40">
                      <span className="font-mono">value: {String(a.value)}</span>
                      <span className="font-mono">threshold: {a.threshold}</span>
                      <span className="ml-auto">{new Date(a.detectedAt).toLocaleString("mn-MN")}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}