"use client";

import React from "react";

interface LoginFormProps {
  email: string;
  password: string;
  isAuthLoading: boolean;
  onEmailChange: (val: string) => void;
  onPasswordChange: (val: string) => void;
  onLogin: (e: React.FormEvent) => void;
}

export const LoginForm = ({ email, password, isAuthLoading, onEmailChange, onPasswordChange, onLogin }: LoginFormProps) => {
  return (
    <main className="flex-1 flex items-center justify-center p-4 bg-background transition-colors duration-200">
      <div className="w-full border border-border bg-card rounded-lg p-4 shadow-sm transition-colors duration-200 max-w-sm">
        <div className="text-center mb-3">
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Login Required</h2>
        </div>

        <form onSubmit={onLogin} className="space-y-2">
          <div>
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              className="w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors"
            />
          </div>

          <div>
            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              className="w-full bg-background border border-border rounded p-2 text-xs text-foreground placeholder-zinc-500 focus:outline-none focus:border-foreground/30 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={isAuthLoading}
            className="w-full bg-foreground text-background hover:opacity-90 font-bold py-1.5 rounded text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {isAuthLoading ? "Loading..." : "Sign In"}
          </button>
        </form>
      </div>
    </main>
  );
};
