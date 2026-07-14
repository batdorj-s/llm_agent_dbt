"use client";

import React, { useState, useEffect, useRef } from "react";
import { Sun, Moon, MessageSquare, LayoutDashboard, FileText, Menu, X, BookOpen, ShieldCheck, GitBranch, Calendar, Users, Search, ChevronDown } from "lucide-react";
import { ServerStatus } from "./types";
import { AvatarDropdown, DocLink } from "./RightContent";
import { GlobalSearch } from "./GlobalSearch";

export type TabId = "ask" | "dashboard" | "report" | "glossary" | "quality" | "lineage" | "scheduler" | "sharing";

interface HeaderProps {
  serverStatus: ServerStatus | null;
  isLoggedIn: boolean;
  user: { email: string; role: string } | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  authToken?: string | null;
}

const MAIN_TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "ask", label: "Асуулт", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
  { id: "report", label: "Тайлан", icon: <FileText className="w-3.5 h-3.5" /> },
];

const SECONDARY_TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "glossary", label: "Толь", icon: <BookOpen className="w-3.5 h-3.5" /> },
  { id: "quality", label: "Чанар", icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  { id: "lineage", label: "Lineage", icon: <GitBranch className="w-3.5 h-3.5" /> },
  { id: "scheduler", label: "Хуваарь", icon: <Calendar className="w-3.5 h-3.5" /> },
  { id: "sharing", label: "Хамтрах", icon: <Users className="w-3.5 h-3.5" /> },
];

export const Header = ({ serverStatus, isLoggedIn, user, theme, onToggleTheme, onLogout, activeTab, onTabChange, authToken }: HeaderProps) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [overflowOpen]);

  const isSecondaryTabActive = SECONDARY_TABS.some((t) => t.id === activeTab);

  return (
    <header className="border-b border-border bg-background px-4 sm:px-6 py-3 flex items-center justify-between transition-colors duration-200">
      <div className="flex items-center gap-2">
        <span className="font-bold text-foreground text-sm tracking-tight">Шинжээч.ai</span>
        <span className="text-[10px] text-foreground/50 font-mono hidden sm:inline">v1.3</span>
      </div>

      {/* Desktop nav */}
      {isLoggedIn && (
        <nav className="hidden sm:flex items-center gap-1" role="tablist" aria-label="Үндсэн цэс">
          {MAIN_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              role="tab"
              aria-selected={activeTab === t.id}
              aria-controls={`panel-${t.id}`}
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

          {/* Overflow dropdown for secondary tabs */}
          <div ref={overflowRef} className="relative">
            <button
              onClick={() => setOverflowOpen(!overflowOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all cursor-pointer ${
                isSecondaryTabActive
                  ? "text-foreground bg-foreground/10"
                  : "text-foreground/40 hover:text-foreground/70 hover:bg-foreground/5"
              }`}
            >
              Бусад
              <ChevronDown className={`w-3 h-3 transition-transform ${overflowOpen ? "rotate-180" : ""}`} />
            </button>

            {overflowOpen && (
              <div className="absolute top-full right-0 mt-1 z-50 min-w-[180px] bg-card border border-border rounded-xl shadow-xl py-1.5 overflow-hidden">
                {SECONDARY_TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { onTabChange(t.id); setOverflowOpen(false); }}
                    role="tab"
                    aria-selected={activeTab === t.id}
                    aria-controls={`panel-${t.id}`}
                    className={`flex items-center gap-2.5 w-full px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                      activeTab === t.id
                        ? "text-foreground bg-foreground/10"
                        : "text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5"
                    }`}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
      )}

      {/* Mobile hamburger */}
      {isLoggedIn && (
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="sm:hidden p-1.5 text-foreground/50 hover:text-foreground transition-colors cursor-pointer"
          aria-label={mobileMenuOpen ? "Цэс хаах" : "Цэс нээх"}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
      )}

      {/* Mobile dropdown menu */}
      {isLoggedIn && mobileMenuOpen && (
        <div className="absolute top-full left-0 right-0 z-50 bg-background border-b border-border shadow-lg sm:hidden">
          {MAIN_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { onTabChange(t.id); setMobileMenuOpen(false); }}
              role="tab"
              aria-selected={activeTab === t.id}
              className={`flex items-center gap-2 w-full px-4 py-3 text-xs font-medium transition-colors cursor-pointer ${
                activeTab === t.id
                  ? "text-foreground bg-foreground/10"
                  : "text-foreground/60 hover:bg-foreground/5"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
          <div className="border-t border-border/40 my-1" />
          <div className="px-4 py-1.5 text-[9px] text-foreground/30 uppercase tracking-wider font-semibold">Бусад</div>
          {SECONDARY_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { onTabChange(t.id); setMobileMenuOpen(false); }}
              role="tab"
              aria-selected={activeTab === t.id}
              className={`flex items-center gap-2 w-full px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                activeTab === t.id
                  ? "text-foreground bg-foreground/10"
                  : "text-foreground/50 hover:bg-foreground/5"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      )}

      {isLoggedIn && (
        <div className="hidden sm:block">
          <GlobalSearch token={authToken ?? null} />
        </div>
      )}

      <div className="flex items-center gap-2 sm:gap-4">
        {isLoggedIn && user && (
          <div className="flex items-center gap-1">
            <DocLink />
            <AvatarDropdown
              user={user}
              theme={theme}
              onToggleTheme={onToggleTheme}
              onLogout={onLogout}
            />
          </div>
        )}

        <button
          type="button"
          onClick={onToggleTheme}
          className="p-1 text-foreground/50 hover:text-foreground transition-colors cursor-pointer flex items-center justify-center active:scale-95 duration-100"
          title={theme === "light" ? "Харанхуй горим" : "Гэрэлт горим"}
          aria-label={theme === "light" ? "Харанхуй горим руу шилжүүлэх" : "Гэрэлт горим руу шилжүүлэх"}
        >
          {theme === "light" ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
        </button>
      </div>
    </header>
  );
};
