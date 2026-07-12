"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthContextValue {
  token: string;
  user: AuthUser | null;
  isLoggedIn: boolean;
  threadId: string;
  isAuthLoading: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  register: (email: string, password: string, name: string) => Promise<string | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_STORAGE_KEY = "shinjech_auth";

function loadStoredAuth(): { token: string; user: AuthUser } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.token && parsed?.user) return parsed;
  } catch {}
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [threadId, setThreadId] = useState(`thread_${Date.now()}`);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = loadStoredAuth();
    if (stored) {
      setToken(stored.token);
      setUser(stored.user);
    }
    setIsAuthLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return data.error || "Login failed";
      setToken(data.token);
      setUser(data.user);
      setThreadId(`thread_${Date.now()}`);
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: data.token, user: data.user }));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Login failed";
    }
  }, []);

  const register = useCallback(async (email: string, password: string, name: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok) return data.error || "Registration failed";
      setToken(data.token);
      setUser(data.user);
      setThreadId(`thread_${Date.now()}`);
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: data.token, user: data.user }));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Registration failed";
    }
  }, []);

  const logout = useCallback(() => {
    setToken("");
    setUser(null);
    setThreadId(`thread_${Date.now()}`);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, isLoggedIn: !!user, threadId, isAuthLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fallback for components not wrapped in AuthProvider
    return {
      token: "",
      user: { id: "user-admin-001", name: "Admin", email: "admin@local", role: "admin" },
      isLoggedIn: true,
      threadId: `thread_${Date.now()}`,
      isAuthLoading: false,
      login: async () => null,
      register: async () => null,
      logout: () => {},
    };
  }
  return ctx;
}

export function useRequireAuth() {
  const auth = useAuth();
  return {
    token: auth.token,
    user: auth.user,
    isLoggedIn: auth.isLoggedIn,
  };
}
