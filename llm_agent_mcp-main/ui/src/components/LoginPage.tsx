"use client";

import React, { useState } from "react";
import { LogIn, UserPlus, Eye, EyeOff } from "lucide-react";

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<string | null>;
  onRegister: (email: string, password: string, name: string) => Promise<string | null>;
}

export function LoginPage({ onLogin, onRegister }: LoginPageProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const result = mode === "login"
      ? await onLogin(email, password)
      : await onRegister(email, password, name);

    if (result) {
      setError(result);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">Шинжээч.ai</h1>
          <p className="text-xs text-foreground/40 mt-1">Өгөгдлийн шинжилгээний платформ</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          {/* Mode Toggle */}
          <div className="flex mb-6 bg-muted rounded-lg p-0.5">
            <button onClick={() => { setMode("login"); setError(""); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-md transition-all cursor-pointer ${
                mode === "login" ? "bg-background shadow-sm text-foreground font-medium" : "text-foreground/50 hover:text-foreground/70"
              }`}>
              <LogIn className="w-3.5 h-3.5" />
              Нэвтрэх
            </button>
            <button onClick={() => { setMode("register"); setError(""); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-md transition-all cursor-pointer ${
                mode === "register" ? "bg-background shadow-sm text-foreground font-medium" : "text-foreground/50 hover:text-foreground/70"
              }`}>
              <UserPlus className="w-3.5 h-3.5" />
              Бүртгүүлэх
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
            {mode === "register" && (
              <div>
                <label className="block text-[10px] font-medium text-foreground/60 uppercase tracking-wider mb-1">Нэр</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} required
                  placeholder="Таны нэр" autoComplete="name"
                  className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-foreground/30 transition-colors" />
              </div>
            )}
            <div>
              <label className="block text-[10px] font-medium text-foreground/60 uppercase tracking-wider mb-1">Имэйл</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="admin@company.mn" autoComplete="username"
                className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-foreground/30 transition-colors" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-foreground/60 uppercase tracking-wider mb-1">Нууц үг</label>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required
                  placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="w-full px-3 py-2 pr-8 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-foreground/30 transition-colors" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground/60 cursor-pointer">
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-500 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button type="submit" disabled={isLoading}
              className="w-full py-2.5 bg-foreground text-background text-xs font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer">
              {isLoading ? "Ачаалж байна..." : mode === "login" ? "Нэвтрэх" : "Бүртгүүлэх"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
