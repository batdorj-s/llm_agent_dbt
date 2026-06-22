import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import type { UserRole } from "./multi-agent.js";

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

const DEV_JWT_SECRET_FALLBACK = "dev-secret-change-in-production-min-32-chars!!";
const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET_FALLBACK;

export function isUsingDevJwtSecret(): boolean {
    return JWT_SECRET === DEV_JWT_SECRET_FALLBACK;
}

export function requireJwtSecret(): void {
    if (isUsingDevJwtSecret()) {
        if (process.env.NODE_ENV === "production") {
            console.error("\n❌ FATAL: JWT_SECRET not set in production.");
            process.exit(1);
        }
        console.warn("\n⚠️  WARNING: Using development JWT_SECRET. Set JWT_SECRET in production.");
    }
}

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

export function createToken(userId: string, role: UserRole): string {
  const header  = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now     = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({ userId, role, iat: now, exp: now + JWT_EXPIRES_IN_SECONDS })
  );
  const signature = sign(`${header}.${payload}`, JWT_SECRET);
  return `${header}.${payload}.${signature}`;
}

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

    const validRoles: UserRole[] = ["viewer", "analyst", "admin"];
    if (!validRoles.includes(decoded.role)) {
      return { success: false, error: `Invalid role: ${decoded.role}` };
    }

    return { success: true, payload: decoded };
  } catch (err) {
    return { success: false, error: `Token parse error: ${(err as Error).message}` };
  }
}

export function verifyBearerHeader(authHeader: string | undefined): AuthResult {
  if (!authHeader?.startsWith("Bearer ")) {
    return { success: false, error: "Missing or malformed Authorization header" };
  }
  return verifyToken(authHeader.slice(7));
}

const ROLE_HIERARCHY: Record<UserRole, number> = {
  viewer: 1,
  analyst: 2,
  admin: 3,
};

export function roleAtLeast(role: UserRole, minRole: UserRole): boolean {
  return (ROLE_HIERARCHY[role] ?? 0) >= (ROLE_HIERARCHY[minRole] ?? 0);
}

export function requireRole(token: string, minRole: UserRole = "admin"): TokenPayload {
  const result = verifyToken(token);
  if (!result.success || !result.payload) {
    throw new Error(`Unauthorized: ${result.error}`);
  }
  if (!roleAtLeast(result.payload.role, minRole)) {
    throw new Error(`Forbidden: requires ${minRole} role, got ${result.payload.role}`);
  }
  return result.payload;
}

// ─────────────────────────────────────────────────────────────
// Password hashing (Node.js built-in crypto.scryptSync)
// ─────────────────────────────────────────────────────────────

const HASH_SALT_LEN = 16;
const HASH_KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(HASH_SALT_LEN).toString("hex");
  const hash = crypto.scryptSync(password, salt, HASH_KEY_LEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const derived = crypto.scryptSync(password, salt, HASH_KEY_LEN);
  const derivedHex = derived.toString("hex");
  if (derivedHex.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(derivedHex), Buffer.from(hash));
}
