"use client";

/**
 * AdminRefineProvider — Refine instance for the admin CMS.
 * Bridges the app's useAuth store into Refine's auth/data/access providers.
 */

import React from "react";
import { Refine } from "@refinedev/core";
import { useAuth } from "../../hooks/useAuth";
import { createAdminDataProvider } from "./dataProvider";
import { createAdminAuthProvider } from "./authProvider";
import { createAdminAccessControl } from "./accessControl";

interface AdminRefineProviderProps {
  children: React.ReactNode;
}

export function AdminRefineProvider({ children }: AdminRefineProviderProps) {
  const auth = useAuth();

  const dataProvider = createAdminDataProvider(() => auth.token);
  const authProvider = createAdminAuthProvider({
    getToken: () => auth.token,
    getUser: () => auth.user,
    login: auth.login,
    logout: auth.logout,
    isLoggedIn: () => auth.isLoggedIn,
    isLoading: () => auth.isAuthLoading,
  });
  const accessControlProvider = createAdminAccessControl(() => auth.user?.role ?? null);

  return (
    <Refine
      dataProvider={dataProvider}
      authProvider={authProvider}
      accessControlProvider={accessControlProvider}
      options={{ disableTelemetry: true, projectId: "admin-cms" }}
    >
      {children}
    </Refine>
  );
}
