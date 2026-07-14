/**
 * RBAC (Role-Based Access Control) Middleware
 *
 * Roles:
 *   - viewer:  Read-only access to dashboards, reports
 *   - analyst: Read + write queries, export, anomaly detection
 *   - admin:   Full access + user management, uploads, settings
 */

import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "../agents/agentState.js";

/**
 * Granular permissions per role
 */
const PERMISSIONS: Record<UserRole, Set<string>> = {
  viewer: new Set([
    "dashboard:read",
    "kpi:read",
    "report:read",
    "chat:send",
    "conversation:read",
    "conversation:create",
    "conversation:delete",
    "metrics:read",
  ]),
  analyst: new Set([
    // viewer permissions
    "dashboard:read",
    "kpi:read",
    "report:read",
    "chat:send",
    "conversation:read",
    "conversation:create",
    "conversation:delete",
    // analyst additions
    "kpi:anomaly",
    "kpi:whatif",
    "export:csv",
    "export:json",
    "sql:query",
    "alert:read",
  ]),
  admin: new Set([
    // all permissions
    "dashboard:read",
    "kpi:read",
    "kpi:anomaly",
    "kpi:whatif",
    "report:read",
    "chat:send",
    "conversation:read",
    "conversation:create",
    "conversation:delete",
    "export:csv",
    "export:json",
    "sql:query",
    "alert:read",
    // admin additions
    "admin:users",
    "admin:upload",
    "admin:settings",
    "admin:system",
  ]),
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: UserRole, permission: string): boolean {
  return PERMISSIONS[role]?.has(permission) ?? false;
}

/**
 * Require a specific permission. Returns 403 if not authorized.
 * Usage: requirePermission("kpi:anomaly")
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user?.role) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!hasPermission(user.role, permission)) {
      res.status(403).json({
        error: "Insufficient permissions",
        required: permission,
        currentRole: user.role,
      });
      return;
    }
    next();
  };
}

/**
 * Require minimum role level.
 * viewer < analyst < admin
 * Usage: requireRole("analyst") — allows analyst and admin
 */
export function requireRole(minRole: UserRole) {
  const roleLevels: Record<UserRole, number> = { viewer: 0, analyst: 1, admin: 2 };
  const minLevel = roleLevels[minRole];

  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user?.role) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const userLevel = roleLevels[user.role as UserRole] ?? 0;
    if (userLevel < minLevel) {
      res.status(403).json({
        error: "Insufficient role level",
        required: minRole,
        currentRole: user.role,
      });
      return;
    }
    next();
  };
}

/**
 * Get all permissions for a role
 */
export function getPermissions(role: UserRole): string[] {
  return Array.from(PERMISSIONS[role] ?? []);
}
