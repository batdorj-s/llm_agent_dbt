/**
 * admin-users.router.ts — Admin User Management
 *
 * GET    /api/admin/users          → List users (search / role filter)
 * POST   /api/admin/users          → Create user (email, password, name, role)
 * PATCH  /api/admin/users/:id      → Update role / name
 * DELETE /api/admin/users/:id      → Delete user (cascades api_keys)
 *
 * All routes require auth + admin:users permission.
 */

import { Router } from "express";
import { getPool } from "../db/pool.js";
import { createUser } from "../db/catalog.js";
import { requirePermission } from "../middleware/rbac.js";
import { log } from "./shared.js";
import type { UserRole } from "../agents/agentState.js";

const router = Router();

const VALID_ROLES: UserRole[] = ["viewer", "analyst", "admin"];

/** List users with optional search and role filter */
router.get("/users", requirePermission("admin:users"), async (req, res) => {
  try {
    const { search, role } = req.query;
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (search && typeof search === "string") {
      clauses.push(`(email ILIKE $${params.length + 1} OR name ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }
    if (role && typeof role === "string" && VALID_ROLES.includes(role as UserRole)) {
      clauses.push(`role = $${params.length + 1}`);
      params.push(role);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await getPool().query(
      `SELECT id, email, name, role, created_at
       FROM users ${where}
       ORDER BY created_at DESC`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      meta: { total: result.rows.length },
    });
  } catch (err) {
    log("error", "Failed to list users", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to list users" });
  }
});

/** Create user (email, password, name, optional role) */
router.post("/users", requirePermission("admin:users"), async (req, res) => {
  try {
    const { email, password, name, role } = req.body ?? {};

    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: "A valid email is required" });
      return;
    }
    if (typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    if (role !== undefined && !VALID_ROLES.includes(role as UserRole)) {
      res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
      return;
    }

    const userId = await createUser(email.trim().toLowerCase(), password, name.trim(), (role as UserRole) ?? "viewer");
    if (!userId) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    log("info", `User created: ${userId}`, req as any, { email: email.trim().toLowerCase(), role: role ?? "viewer" });
    res.status(201).json({
      success: true,
      data: { id: userId, email: email.trim().toLowerCase(), name: name.trim(), role: role ?? "viewer" },
    });
  } catch (err) {
    log("error", "Failed to create user", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to create user" });
  }
});

/** Update user role / name */
router.patch("/users/:id", requirePermission("admin:users"), async (req, res) => {
  try {
    const { id } = req.params;
    const { role, name } = req.body;
    const actingUserId = (req as any).user?.userId as string | undefined;

    if (role !== undefined && !VALID_ROLES.includes(role as UserRole)) {
      res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
      return;
    }
    if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    if (role === undefined && name === undefined) {
      res.status(400).json({ error: "At least one of role or name is required" });
      return;
    }
    if (id === actingUserId) {
      res.status(400).json({ error: "You cannot change your own admin account" });
      return;
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (role !== undefined) {
      sets.push(`role = $${params.length + 1}`);
      params.push(role);
    }
    if (name !== undefined) {
      sets.push(`name = $${params.length + 1}`);
      params.push(name.trim());
    }
    params.push(id);

    const result = await getPool().query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING id, email, name, role, created_at`,
      params
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    log("info", `User updated: ${id}`, req as any, { role, name });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    log("error", "Failed to update user", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to update user" });
  }
});

/** Delete user (api_keys cascade) */
router.delete("/users/:id", requirePermission("admin:users"), async (req, res) => {
  try {
    const { id } = req.params;
    const actingUserId = (req as any).user?.userId as string | undefined;

    if (id === actingUserId) {
      res.status(400).json({ error: "You cannot delete your own admin account" });
      return;
    }

    const result = await getPool().query(
      `DELETE FROM users WHERE id = $1 RETURNING id, email`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    log("info", `User deleted: ${id}`, req as any, { email: result.rows[0].email });
    res.json({ success: true, message: "User deleted" });
  } catch (err) {
    log("error", "Failed to delete user", req as any, { error: (err as Error).message });
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;
