"use client";

import React from "react";
import { LogOut, Sun, Moon, MessageSquare, LayoutDashboard, FileText } from "lucide-react";
import { ServerStatus } from "./types";

type TabId = "ask" | "dashboard" | "report";

interface HeaderProps {
  serverStatus: ServerStatus | null;
  isLoggedIn: boolean;
  user: { email: string; role: string } | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "ask", label: "Асуулт", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
  { id: "report", label: "Тайлан", icon: <FileText className="w-3.5 h-3.5" /> },
];

export const Header = ({ serverStatus, isLoggedIn, user, theme, onToggleTheme, onLogout, activeTab, onTabChange }: HeaderProps) => {
  return (
    <header className="border-b border-border bg-background px-6 py-3 flex items-center justify-between transition-colors duration-200">
      <div className="flex items-center gap-2">
        <span className="font-bold text-foreground text-sm tracking-tight">Шинжээч.ai</span>
        <span className="text-[10px] text-foreground/50 font-mono">v1.3</span>
      </div>

      {isLoggedIn && (
        <div className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all cursor-pointer ${
                activeTab === t.id
                  ? "text-foreground bg-foreground/10"
                  : "text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4">
        {serverStatus && (
          <div className="flex items-center gap-1.5 text-[10px] text-foreground/50 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>{serverStatus.llm.model}</span>
          </div>
        )}

        {isLoggedIn && user && (
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-foreground/50 font-mono">
              {user.email}
            </span>
            <button
              onClick={onLogout}
              className="p-1 text-foreground/50 hover:text-foreground transition-colors cursor-pointer"
              title="Log Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onToggleTheme}
          className="p-1 text-foreground/50 hover:text-foreground transition-colors cursor-pointer flex items-center justify-center active:scale-95 duration-100"
          title={theme === "light" ? "Харанхуй горим" : "Гэрэлт горим"}
        >
          {theme === "light" ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
        </button>
      </div>
    </header>
  );
};
