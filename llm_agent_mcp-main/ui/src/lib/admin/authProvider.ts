"use client";

/**
 * authProvider.ts — Refine auth provider bound to the app's useAuth store.
 * Admin CMS is admin-role only; analyst/guest are rejected with 403 semantics.
 */

import type { AuthProvider, AuthActionResponse, CheckResponse } from "@refinedev/core";

interface AuthBridge {
  getToken: () => string;
  getUser: () => { id: string; name: string; email: string; role: string } | null;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
  isLoggedIn: () => boolean;
  isLoading: () => boolean;
}

export const ADMIN_ROLES = ["admin"] as const;

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin";
}

export function createAdminAuthProvider(bridge: AuthBridge): AuthProvider {
  return {
    login: async ({ email, password }): Promise<AuthActionResponse> => {
      const error = await bridge.login(email, password);
      if (error) {
        return {
          success: false,
          error: { name: "LoginError", message: error, statusCode: 401 },
        };
      }
      const user = bridge.getUser();
      if (!user || !isAdminRole(user.role)) {
        bridge.logout();
        return {
          success: false,
          error: {
            name: "Forbidden",
            message: "Зөвхөн admin эрхтэй хэрэглэгч CMS-д нэвтрэх боломжтой",
            statusCode: 403,
          },
        };
      }
      return {
        success: true,
        redirectTo: "/admin",
      };
    },

    logout: async (): Promise<AuthActionResponse> => {
      bridge.logout();
      return { success: true, redirectTo: "/admin/login" };
    },

    check: async (): Promise<CheckResponse> => {
      if (!bridge.isLoggedIn()) {
        return {
          authenticated: false,
          redirectTo: "/admin/login",
          logout: true,
        };
      }
      const user = bridge.getUser();
      if (!user || !isAdminRole(user.role)) {
        return {
          authenticated: false,
          redirectTo: "/admin/403",
          logout: false,
        };
      }
      return { authenticated: true };
    },

    onError: async () => ({}),

    getIdentity: async () => {
      const user = bridge.getUser();
      return user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null;
    },

    getPermissions: async () => {
      const user = bridge.getUser();
      return user ? [user.role] : [];
    },
  };
}
