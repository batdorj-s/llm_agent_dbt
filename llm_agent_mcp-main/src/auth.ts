/**
 * auth.ts — JWT-based authentication & role verification
 *
 * Provides:
 *  - createToken(userId, role)  — sign a JWT (for testing/login endpoint)
 *  - verifyToken(token)         — decode & validate a JWT, return role
 *  - generateDemoTokens()       — create demo tokens for each role (dev only)
 *
 * Environment variables required:
 *   JWT_SECRET=your-strong-random-secret-here   (min 32 chars recommended)
 *   JWT_EXPIRES_IN=1h                            (optional, default: 1h)
 */

import dotenv from "dotenv";
dotenv.config();

import type { UserRole } from "./multi-agent.js";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export interface TokenPayload {
  userId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface AuthResult {
  success: boolean;
  payload?: TokenPayload;
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// Minimal JWT implementation (no external dependency)
// Uses HMAC-SHA256 via Node.js built-in crypto
// ─────────────────────────────────────────────────────────────
import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production-min-32-chars!!";
const JWT_EXPIRES_IN_SECONDS = parseExpiry(process.env.JWT_EXPIRES_IN || "1h");

function parseExpiry(expr: string): number {
  const match = expr.match(/^(\d+)([smhd])$/);
  if (!match) return 3600;
  const [, val, unit] = match;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return parseInt(val) * (multipliers[unit] ?? 3600);
}

function base64url(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function sign(data: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Create a signed JWT token for a user.
 */
export function createToken(userId: string, role: UserRole): string {
  const header  = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now     = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({ userId, role, iat: now, exp: now + JWT_EXPIRES_IN_SECONDS })
  );
  const signature = sign(`${header}.${payload}`, JWT_SECRET);
  return `${header}.${payload}.${signature}`;
}

/**
 * Verify a JWT and return the decoded payload.
 * Returns { success: false, error } if the token is invalid or expired.
 */
export function verifyToken(token: string): AuthResult {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { success: false, error: "Malformed token" };
    }

    const [header, payload, signature] = parts;
    const expectedSig = sign(`${header}.${payload}`, JWT_SECRET);

    if (signature !== expectedSig) {
      return { success: false, error: "Invalid token signature" };
    }

    const decoded: TokenPayload = JSON.parse(Buffer.from(payload, "base64url").toString());
    const now = Math.floor(Date.now() / 1000);

    if (decoded.exp && decoded.exp < now) {
      return { success: false, error: "Token expired" };
    }

    const validRoles: UserRole[] = ["admin"];
    if (!validRoles.includes(decoded.role)) {
      return { success: false, error: `Invalid role: ${decoded.role}` };
    }

    return { success: true, payload: decoded };
  } catch (err) {
    return { success: false, error: `Token parse error: ${(err as Error).message}` };
  }
}

/**
 * Extract and verify a Bearer token from an Authorization header.
 * Header format: "Authorization: Bearer <token>"
 */
export function verifyBearerHeader(authHeader: string | undefined): AuthResult {
  if (!authHeader?.startsWith("Bearer ")) {
    return { success: false, error: "Missing or malformed Authorization header" };
  }
  return verifyToken(authHeader.slice(7));
}

/**
 * Guard: throws if the token role doesn't meet minimum required role.
 * (Simplified: everything is admin now)
 */
export function requireRole(token: string, minRole: UserRole = "admin"): TokenPayload {
  const result = verifyToken(token);
  if (!result.success || !result.payload) {
    throw new Error(`Unauthorized: ${result.error}`);
  }
  return result.payload;
}

// ─────────────────────────────────────────────────────────────
// Dev helper — generate demo tokens (never use in production)
// ─────────────────────────────────────────────────────────────
export function generateDemoTokens(): Record<UserRole, string> {
  return {
    admin:  createToken("user-admin-001",  "admin"),
  };
}
