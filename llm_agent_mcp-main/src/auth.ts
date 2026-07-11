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

export function parseExpiry(expr: string): number {
  const match = expr.match(/^(\d+)([smhd])$/);
  if (!match) return 3600;
  const [, val, unit] = match;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return parseInt(val) * (multipliers[unit] ?? 3600);
}

export function base64url(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function sign(data: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const DEV_JWT_SECRET_FALLBACK = "dev-secret-change-in-production-min-32-chars!!";
const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET_FALLBACK;
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("[FATAL] JWT_SECRET is required in production. Exiting.");
    process.exit(1);
  }
  console.warn("[WARN] JWT_SECRET not set — using insecure dev fallback. Set JWT_SECRET in .env for production.");
}

export function createToken(userId: string, role: UserRole): string {
  const header  = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now     = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({ userId, role, iat: now, exp: now + 3600 })
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
