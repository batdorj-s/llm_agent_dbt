/**
 * rate-limiter.ts — Sliding-window rate limiter with Redis, PostgreSQL, or in-memory backend.
 *
 * Backend priority:
 *   1. Redis (if REDIS_URL is set)
 *   2. PostgreSQL (if DATABASE_URL is configured and available)
 *   3. In-memory (development / single-instance only, lost on restart)
 *
 * Each RateLimiter instance owns its own in-memory store.
 * All instances share a single Redis connection when Redis is configured.
 */

import type { Redis as RedisClient } from "ioredis";
import { getPool, isPgAvailable } from "./db/pool.js";

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  message?: string;
}

// ─────────────────────────────────────────────────────────────
// In-memory backend (per-instance store — safe across tests)
// ─────────────────────────────────────────────────────────────

class MemoryBackend {
  private readonly store = new Map<string, number[]>();

  check(key: string, maxRequests: number, windowMs: number): RateLimitResult {
    const now    = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (this.store.get(key) ?? []).filter(t => t > cutoff);

    if (timestamps.length >= maxRequests) {
      const resetInMs = windowMs - (now - timestamps[0]);
      return {
        allowed: false, remaining: 0, resetInMs,
        message: `Rate limit exceeded. Try again in ${Math.ceil(resetInMs / 1000)}s (limit: ${maxRequests} req/${windowMs / 1000}s).`,
      };
    }

    timestamps.push(now);
    this.store.set(key, timestamps);
    return { allowed: true, remaining: maxRequests - timestamps.length, resetInMs: windowMs };
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  stats(key: string, maxRequests: number, windowMs: number): { requests: number; remaining: number } {
    const now    = Date.now();
    const cutoff = now - windowMs;
    const count  = (this.store.get(key) ?? []).filter(t => t > cutoff).length;
    return { requests: count, remaining: Math.max(0, maxRequests - count) };
  }

  cleanup(windowMs: number): void {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of this.store.entries()) {
      const active = timestamps.filter(t => t > cutoff);
      if (active.length === 0) this.store.delete(key);
      else this.store.set(key, active);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Redis backend (multi-instance / production)
// Shared Redis client — lazily initialized on first use
// ─────────────────────────────────────────────────────────────

let _redisClient: RedisClient | null = null;
let _redisResolved = false;

async function getRedisClient(): Promise<RedisClient | null> {
  if (_redisResolved) return _redisClient;
  _redisResolved = true;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn("[rate-limiter] REDIS_URL not set — using in-memory store (not safe for multi-instance deployments).");
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { default: RedisCtor } = (await import("ioredis")) as any;
    const client = new RedisCtor(redisUrl, { lazyConnect: true, connectTimeout: 3000 }) as RedisClient;
    await client.connect();
    _redisClient = client;
    console.log(`[rate-limiter] Redis backend connected: ${redisUrl}`);
    return client;
  } catch (err) {
    console.warn(`[rate-limiter] Redis unavailable (${(err as Error).message}), falling back to in-memory.`);
    return null;
  }
}

async function redisCheck(client: RedisClient, key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult> {
  const now    = Date.now();
  const cutoff = now - windowMs;
  const expireS = Math.ceil(windowMs / 1000) + 1;

  const pipeline = client.pipeline();
  pipeline.zremrangebyscore(key, "-inf", cutoff);
  pipeline.zcard(key);
  pipeline.zrange(key, 0, 0, "WITHSCORES");
  const results = await pipeline.exec();
  const count = (results?.[1]?.[1] as number) ?? 0;

  if (count >= maxRequests) {
    const oldest = Number((results?.[2]?.[1] as string[])?.[1] ?? now);
    const resetInMs = windowMs - (now - oldest);
    return {
      allowed: false, remaining: 0, resetInMs,
      message: `Rate limit exceeded. Try again in ${Math.ceil(resetInMs / 1000)}s (limit: ${maxRequests} req/${windowMs / 1000}s).`,
    };
  }

  const member = `${now}-${Math.random().toString(36).slice(2)}`;
  await client.zadd(key, now, member);
  await client.expire(key, expireS);
  return { allowed: true, remaining: maxRequests - count - 1, resetInMs: windowMs };
}

// ─────────────────────────────────────────────────────────────
// PostgreSQL backend (persists across restarts, shared across instances)
// ─────────────────────────────────────────────────────────────

class PostgresBackend {
  async check(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult> {
    if (!isPgAvailable()) return { allowed: false, remaining: 0, resetInMs: 0, message: "Backend unavailable" };
    const pool = getPool();
    const now = new Date();
    const cutoff = new Date(Date.now() - windowMs);

    try {
      await pool.query("DELETE FROM rate_limiter WHERE expires_at < $1", [cutoff]);
      const result = await pool.query(
        "SELECT COUNT(*) AS cnt, MIN(expires_at) AS oldest FROM rate_limiter WHERE key = $1 AND expires_at > $2",
        [key, cutoff]
      );
      const count = Number(result.rows[0]?.cnt ?? 0);

      if (count >= maxRequests) {
        const oldestMs = result.rows[0]?.oldest ? new Date(result.rows[0].oldest as string).getTime() : Date.now();
        const resetInMs = Math.max(0, windowMs - (Date.now() - (oldestMs - windowMs)));
        return {
          allowed: false, remaining: 0, resetInMs,
          message: `Rate limit exceeded. Try again in ${Math.ceil(resetInMs / 1000)}s (limit: ${maxRequests} req/${windowMs / 1000}s).`,
        };
      }

      const expiresAt = new Date(Date.now() + windowMs);
      await pool.query(
        "INSERT INTO rate_limiter (key, expires_at) VALUES ($1, $2)",
        [key, expiresAt]
      );
      return { allowed: true, remaining: maxRequests - count - 1, resetInMs: windowMs };
    } catch {
      return { allowed: false, remaining: 0, resetInMs: 0, message: "Rate limiter backend error" };
    }
  }

  async reset(key: string): Promise<void> {
    if (!isPgAvailable()) return;
    try {
      await getPool().query("DELETE FROM rate_limiter WHERE key = $1", [key]);
    } catch { /* ignore */ }
  }

  async stats(key: string, maxRequests: number, windowMs: number): Promise<{ requests: number; remaining: number }> {
    if (!isPgAvailable()) return { requests: 0, remaining: maxRequests };
    try {
      const cutoff = new Date(Date.now() - windowMs);
      const result = await getPool().query(
        "SELECT COUNT(*) AS cnt FROM rate_limiter WHERE key = $1 AND expires_at > $2",
        [key, cutoff]
      );
      const count = Number(result.rows[0]?.cnt ?? 0);
      return { requests: count, remaining: Math.max(0, maxRequests - count) };
    } catch {
      return { requests: 0, remaining: maxRequests };
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Public RateLimiter class
// ─────────────────────────────────────────────────────────────

export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly mem = new MemoryBackend();
  private readonly pg = new PostgresBackend();

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs    = options.windowMs ?? 60_000;
  }

  async check(key: string): Promise<RateLimitResult> {
    const redis = await getRedisClient();
    if (redis) return redisCheck(redis, key, this.maxRequests, this.windowMs);
    if (isPgAvailable()) return this.pg.check(key, this.maxRequests, this.windowMs);
    return this.mem.check(key, this.maxRequests, this.windowMs);
  }

  async reset(key: string): Promise<void> {
    const redis = await getRedisClient();
    if (redis) { await redis.del(key); return; }
    if (isPgAvailable()) { await this.pg.reset(key); return; }
    this.mem.reset(key);
  }

  async stats(key: string): Promise<{ requests: number; remaining: number }> {
    const redis = await getRedisClient();
    if (redis) {
      const cutoff = Date.now() - this.windowMs;
      await redis.zremrangebyscore(key, "-inf", cutoff);
      const count = await redis.zcard(key);
      return { requests: count, remaining: Math.max(0, this.maxRequests - count) };
    }
    if (isPgAvailable()) return this.pg.stats(key, this.maxRequests, this.windowMs);
    return this.mem.stats(key, this.maxRequests, this.windowMs);
  }

  startCleanup(intervalMs = 300_000): NodeJS.Timeout {
    return setInterval(() => {
      this.mem.cleanup(this.windowMs);
      if (isPgAvailable()) {
        getPool().query("DELETE FROM rate_limiter WHERE expires_at < NOW() - interval '1 hour'").catch(() => {});
      }
    }, intervalMs);
  }
}

// ─────────────────────────────────────────────────────────────
// Pre-configured limiters
// ─────────────────────────────────────────────────────────────

export const agentLimiter   = new RateLimiter({ maxRequests: 10,  windowMs: 60_000 });
export const sandboxLimiter = new RateLimiter({ maxRequests: 5,   windowMs: 60_000 });
export const mcpLimiter     = new RateLimiter({ maxRequests: 30,  windowMs: 60_000 });
export const authLimiter    = new RateLimiter({ maxRequests: 5,   windowMs: 60_000 });
export const registerLimiter = new RateLimiter({ maxRequests: 3,  windowMs: 3600_000 });
export const uploadLimiter  = new RateLimiter({ maxRequests: 10,  windowMs: 60_000 });
