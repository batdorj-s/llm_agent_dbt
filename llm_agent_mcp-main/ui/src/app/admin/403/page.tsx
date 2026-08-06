"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, LogOut } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";
import { isAdminRole } from "../../../lib/admin/authProvider";

export default function AdminForbiddenPage() {
  const { user, isLoggedIn, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace("/admin/login");
    } else if (isAdminRole(user?.role)) {
      router.replace("/admin");
    }
  }, [isLoggedIn, user, router]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
          <ShieldAlert className="w-7 h-7 text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-foreground">403 — Хандах эрхгүй</h1>
        <p className="text-xs text-foreground/50 mt-2 leading-relaxed">
          Энэ хуудас зөвхөн <span className="font-semibold text-foreground/80">admin</span> эрхтэй
          хэрэглэгчдэд нээлттэй. Таны эрх: {user?.role ?? "—"}
        </p>
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => {
              logout();
              router.replace("/admin/login");
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-foreground text-background hover:opacity-90 transition-opacity cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Гарах
          </button>
        </div>
      </div>
    </div>
  );
}
