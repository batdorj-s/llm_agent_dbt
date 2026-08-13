"use client";

/**
 * Admin CMS layout — sidebar shell + admin-only route guard.
 * Non-admin users see the 403 page; unauthenticated users go to /admin/login.
 */

import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  KeyRound,
  Database,
  Activity,
  BarChart,
  Terminal,
  ShieldCheck,
  Bell,
  LogOut,
  Sun,
  Moon,
} from "lucide-react";
import { AdminRefineProvider } from "../../lib/admin/AdminRefineProvider";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";
import { isAdminRole } from "../../lib/admin/authProvider";

const NAV_ITEMS = [
  { href: "/admin", label: "Хянах самбар", icon: LayoutDashboard },
  { href: "/admin/users", label: "Хэрэглэгчид", icon: Users },
  { href: "/admin/api-keys", label: "API түлхүүрүүд", icon: KeyRound },
  { href: "/admin/knowledge-base", label: "Мэдлэгийн сан", icon: Database },
  { href: "/admin/observability", label: "Хяналт", icon: Activity },
  { href: "/admin/analytics", label: "Аналитик", icon: BarChart },
  { href: "/admin/analysis", label: "SQL Шинжилгээ", icon: Terminal },
  { href: "/admin/data-quality", label: "Өгөгдлийн чанар", icon: ShieldCheck },
  { href: "/admin/alerts", label: "Сануулга", icon: Bell },
];

function AdminShell({ children }: { children: React.ReactNode }) {
  const { token, user, isLoggedIn, isAuthLoading, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isAuthLoading) return;
    if (!isLoggedIn || !token) {
      router.replace("/admin/login");
      return;
    }
    if (!isAdminRole(user?.role) && pathname !== "/admin/403") {
      router.replace("/admin/403");
    }
  }, [isAuthLoading, isLoggedIn, token, user, router, pathname]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-foreground/60 text-sm">Ачааллаж байна...</div>
      </div>
    );
  }

  // Non-admin / unauthenticated users get a bare container — only the
  // 403 and login pages render their own content.
  const allowSelfRendered =
    pathname === "/admin/403" ||
    (pathname === "/admin/login" && !isLoggedIn);
  if (!isLoggedIn || token === "") {
    if (allowSelfRendered) {
      return <div className="min-h-screen bg-background">{children}</div>;
    }
    return null;
  }
  if (!isAdminRole(user?.role)) {
    return (
      <div className="min-h-screen bg-background">{pathname === "/admin/403" ? children : null}</div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border bg-sidebar flex flex-col">
        <div className="px-4 py-4 border-b border-border flex items-center gap-2">
          <img src="/logo.svg" alt="Шинжээч.ai лого" className="h-5 w-auto dark:invert" />
          <span className="font-bold text-foreground text-sm tracking-tight">Admin CMS</span>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto" aria-label="Admin цэс">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  active
                    ? "text-foreground bg-foreground/10"
                    : "text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-border space-y-1">
          <div className="px-3 py-1.5 text-[10px] text-foreground/40 truncate">{user?.email}</div>
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs font-medium text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5 cursor-pointer transition-colors"
          >
            {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            {theme === "light" ? "Харанхуй горим" : "Гэрэлт горим"}
          </button>
          <button
            onClick={() => {
              logout();
              router.replace("/admin/login");
            }}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs font-medium text-foreground/50 hover:text-red-500/90 hover:bg-foreground/5 cursor-pointer transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Гарах
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="p-6 max-w-5xl mx-auto">{children}</div>
      </main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminRefineProvider>
      <AdminShell>{children}</AdminShell>
    </AdminRefineProvider>
  );
}
