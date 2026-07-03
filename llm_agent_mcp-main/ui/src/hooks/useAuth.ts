"use client";

import { useState, useEffect } from "react";

export interface AuthUser {
  email: string;
  role: string;
}

export function useAuth() {
  const [token, setToken]           = useState<string | null>(null);
  const [user, setUser]             = useState<AuthUser | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [threadId, setThreadId]     = useState<string>("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // Restore session from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem("agent_token");
    const storedUser  = localStorage.getItem("agent_user");
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      setIsLoggedIn(true);
      setThreadId(`thread_${Date.now()}`);
    }
  }, []);

  const login = async (email: string, password: string): Promise<string | null> => {
    setIsAuthLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Login failed");
      }
      const data = await res.json();
      localStorage.setItem("agent_token", data.token);
      localStorage.setItem("agent_user", JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      setIsLoggedIn(true);
      setThreadId(`thread_${Date.now()}`);
      return null;
    } catch (e: unknown) {
      return e instanceof Error ? e.message : "Connection to API Server failed.";
    } finally {
      setIsAuthLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("agent_token");
    localStorage.removeItem("agent_user");
    setToken(null);
    setUser(null);
    setIsLoggedIn(false);
    setThreadId("");
  };

  return { token, user, isLoggedIn, threadId, isAuthLoading, login, logout };
}
