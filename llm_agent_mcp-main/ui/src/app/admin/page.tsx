"use client";

/**
 * Admin dashboard — platform summary cards via GET /api/admin/summary.
 */

import React from "react";
import Link from "next/link";
import { useCustom } from "@refinedev/core";
import {
  Users,
  KeyRound,
  Database,
  FileText,
  ShieldCheck,
  ClipboardList,
  Activity,
  Zap,
  AlertTriangle,
} from "lucide-react";

interface SummaryData {
  counts: {
    users: number;
    apiKeys: number;
    uploadedFiles: number;
    ragDocuments: number;
    sqlLogs: number;
    sqlSucceeded: number;
    sqlFailed: number;
    sqlLast24h: number;
    activeSchedules: number;
    generatedReports: number;
    qualityTests: number;
    feedbackPending: number;
    feedbackApproved: number;
  };
}

export default function AdminDashboardPage() {
  const { query, result } = useCustom<SummaryData>({
    url: "/api/admin/summary",
    method: "get",
  });
  const counts = result.data?.counts;

  if (query.isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-pulse text-foreground/60 text-sm">Ачааллаж байна...</div>
      </div>
    );
  }

  if (query.isError || !counts) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-foreground/50 text-sm">
        Summary ачаалахад алдаа гарлаа
      </div>
    );
  }

  const cards = [
    { label: "Хэрэглэгчид", value: counts.users, icon: Users, href: "/admin/users" },
    { label: "API түлхүүр", value: counts.apiKeys, icon: KeyRound, href: "/admin/api-keys" },
    { label: "RAG баримт", value: counts.ragDocuments, icon: Database, href: "/admin/knowledge-base" },
    { label: "Файлууд", value: counts.uploadedFiles, icon: FileText, href: "/admin/knowledge-base" },
    { label: "SQL лог", value: counts.sqlLogs, icon: Activity, href: "/admin/observability" },
    { label: "Амжилттай", value: counts.sqlSucceeded, icon: Zap, href: "/admin/observability" },
    { label: "Алдаатай", value: counts.sqlFailed, icon: AlertTriangle, href: "/admin/observability" },
    { label: "Идэвхтэй хуваарь", value: counts.activeSchedules, icon: ClipboardList, href: "/admin/observability" },
    { label: "Генер. тайлан", value: counts.generatedReports, icon: FileText, href: "/admin/observability" },
    { label: "Чанарын тест", value: counts.qualityTests, icon: ShieldCheck, href: "/admin/observability" },
    { label: "Feedback (pending)", value: counts.feedbackPending, icon: ClipboardList, href: "/admin/observability" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Хянах самбар</h1>
        <p className="text-xs text-foreground/50 mt-1">Платформын товч тойм</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="bg-card border border-border rounded-xl p-4 hover:border-foreground/20 transition-colors group"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wider">
                {card.label}
              </span>
              <card.icon className="w-4 h-4 text-foreground/40 group-hover:text-foreground/70 transition-colors" />
            </div>
            <div className="text-2xl font-bold text-foreground tabular-nums">{card.value.toLocaleString()}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
