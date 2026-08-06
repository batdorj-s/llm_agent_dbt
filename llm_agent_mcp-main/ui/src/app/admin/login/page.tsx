"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogIn, ShieldAlert, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";
import { isAdminRole } from "../../../lib/admin/authProvider";

export default function AdminLoginPage() {
  const { login, isLoggedIn, user, isAuthLoading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isAuthLoading) return;
    if (isLoggedIn && isAdminRole(user?.role)) {
      router.replace("/admin");
    } else if (isLoggedIn) {
      router.replace("/admin/403");
    }
  }, [isAuthLoading, isLoggedIn, user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const result = await login(email, password);
    if (result) {
      setError(result);
      setIsLoading(false);
      return;
    }

    if (!isAdminRole(user?.role)) {
      setError("Зөвхөн admin эрхтэй хэрэглэгч нэвтрэх боломжтой");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.svg" alt="Шинжээч.ai" className="h-14 w-auto mx-auto mb-3 dark:invert" />
          <h1 className="text-2xl font-bold text-foreground">Admin CMS</h1>
          <p className="text-xs text-foreground/40 mt-1">Шинжээч.ai удирдлагын систем</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-medium text-foreground/60 uppercase tracking-wider mb-1">Имэйл</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@company.mn"
                autoComplete="username"
                className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-foreground/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-foreground/60 uppercase tracking-wider mb-1">Нууц үг</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-foreground/30 transition-colors pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground/70 cursor-pointer"
                  aria-label={showPassword ? "Нууц үг нуух" : "Нууц үг харуулах"}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-[11px] text-red-500 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg bg-foreground text-background hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              {isLoading ? "Нэвтэрч байна..." : "Нэвтрэх"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
