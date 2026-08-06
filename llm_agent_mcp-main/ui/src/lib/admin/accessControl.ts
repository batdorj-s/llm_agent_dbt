"use client";

/**
 * accessControl.ts — Refine access control provider.
 * All admin resources require the admin role.
 */

import type { AccessControlProvider } from "@refinedev/core";

export const ADMIN_PERMISSION = "admin";

export function createAdminAccessControl(getRole: () => string | null): AccessControlProvider {
  return {
    can: async ({ resource, action }) => {
      const role = getRole();
      const allowed = role === ADMIN_PERMISSION;
      return { can: allowed, reason: allowed ? undefined : "Admin эрх шаардлагатай" };
    },
  };
}
