"use client";

import React from "react";
import {
  BookOpen,
  Globe,
  GitFork,
  User,
  Settings,
  Palette,
  LogOut,
  Sun,
  Moon,
  Check,
} from "lucide-react";
import HeaderDropdown from "./HeaderDropdown";
import type { MenuItem } from "./HeaderDropdown";

/* ─── DocLink ─── */
export const DocLink: React.FC = () => (
  <a
    href="/welcome"
    className="inline-flex items-center justify-center h-9 min-w-9 p-0.5 text-foreground/50 hover:text-foreground transition-colors rounded-lg hover:bg-foreground/5"
    aria-label="Docs"
  >
    <BookOpen className="w-4 h-4" />
  </a>
);

/* ─── LangDropdown ─── */
const localeLabelMap: Record<string, { emoji: string; label: string }> = {
  mn: { emoji: "🇲🇳", label: "Монгол" },
  en: { emoji: "🇺🇸", label: "English" },
};

interface LangDropdownProps {
  currentLocale?: string;
  onLocaleChange?: (locale: string) => void;
}

export const LangDropdown: React.FC<LangDropdownProps> = ({
  currentLocale = "mn",
  onLocaleChange,
}) => {
  const allLocales = Object.keys(localeLabelMap);

  if (allLocales.length <= 1) return null;

  const langItems: MenuItem[] = allLocales.map((locale) => ({
    key: locale,
    icon:
      locale === currentLocale ? (
        <Check className="w-3.5 h-3.5 text-emerald-500" />
      ) : (
        <span className="inline-block w-3.5" />
      ),
    label: `${localeLabelMap[locale]?.emoji ?? ""} ${localeLabelMap[locale]?.label ?? locale}`,
  }));

  return (
    <HeaderDropdown
      placement="bottomRight"
      items={langItems}
      onItemClick={(key) => onLocaleChange?.(key)}
    >
      <button
        className="inline-flex items-center justify-center h-9 min-w-9 p-0.5 text-foreground/50 hover:text-foreground transition-colors rounded-lg hover:bg-foreground/5 cursor-pointer border-none"
        aria-label="Language"
      >
        <Globe className="w-4 h-4" />
      </button>
    </HeaderDropdown>
  );
};

/* ─── VersionDropdown ─── */
const versionItems: MenuItem[] = [
  { key: "https://v5.pro.ant.design", label: "v5" },
  { key: "https://v4.pro.ant.design", label: "v4" },
  { key: "https://v2.pro.ant.design", label: "v2" },
  { key: "https://v1.pro.ant.design", label: "v1" },
];

export const VersionDropdown: React.FC = () => (
  <HeaderDropdown
    placement="bottomRight"
    items={versionItems}
    onItemClick={(key) => window.open(key, "_blank", "noopener,noreferrer")}
  >
    <button
      className="inline-flex items-center justify-center h-9 min-w-9 p-0.5 text-foreground/50 hover:text-foreground transition-colors rounded-lg hover:bg-foreground/5 cursor-pointer border-none"
      aria-label="Versions"
    >
      <GitFork className="w-4 h-4" />
    </button>
  </HeaderDropdown>
);

/* ─── AvatarDropdown ─── */
interface AvatarDropdownProps {
  user: { email: string; role: string } | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
}

export const AvatarDropdown: React.FC<AvatarDropdownProps> = ({
  user,
  theme,
  onToggleTheme,
  onLogout,
}) => {
  if (!user) return null;

  const avatarItems: MenuItem[] = [
    {
      key: "settings",
      icon: <Settings className="w-3.5 h-3.5" />,
      label: "Хувийн тохиргоо",
    },
    {
      key: "theme",
      icon: <Palette className="w-3.5 h-3.5" />,
      label: theme === "light" ? "Харанхуй горим" : "Гэрэлт горим",
    },
    { key: "divider", divider: true, label: "" },
    {
      key: "logout",
      icon: <LogOut className="w-3.5 h-3.5" />,
      label: "Гарах",
      danger: true,
    },
  ];

  const handleItemClick = (key: string) => {
    if (key === "logout") onLogout();
    if (key === "theme") onToggleTheme();
  };

  return (
    <HeaderDropdown
      placement="bottomRight"
      items={avatarItems}
      onItemClick={handleItemClick}
    >
      <div className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded-lg hover:bg-foreground/5 transition-colors">
        <div className="w-6 h-6 rounded-full bg-foreground/10 flex items-center justify-center">
          <User className="w-3.5 h-3.5 text-foreground/50" />
        </div>
        <div className="hidden sm:block">
          <div className="text-[11px] font-medium text-foreground/80 leading-tight">
            {user.email}
          </div>
          <div className="text-[9px] text-foreground/40 leading-tight">
            {user.role === "admin" ? "Админ" : "Хэрэглэгч"}
          </div>
        </div>
      </div>
    </HeaderDropdown>
  );
};
