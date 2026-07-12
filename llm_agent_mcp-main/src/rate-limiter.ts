/**
 * rate-limiter.ts — Sliding-window rate limiter with Redis or in-memory backend.
 *
 * If REDIS_URL is set, uses Redis (safe for multi-instance deployments).
 * Otherwise falls back to in-memory (development / single-instance only).
 *
 * Each RateLimiter instance owns its own in-memory store.
 * All instances share a single Redis connection when Redis is configured.
 */

import type { Redis as RedisClient } from "ioredis";

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
// Public RateLimiter class
// ─────────────────────────────────────────────────────────────

export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly mem = new MemoryBackend();

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs    = options.windowMs ?? 60_000;
  }

  async check(key: string): Promise<RateLimitResult> {
    const redis = await getRedisClient();
    if (redis) return redisCheck(redis, key, this.maxRequests, this.windowMs);
    return this.mem.check(key, this.maxRequests, this.windowMs);
  }

  async reset(key: string): Promise<void> {
    const redis = await getRedisClient();
    if (redis) { await redis.del(key); return; }
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
    return this.mem.stats(key, this.maxRequests, this.windowMs);
  }

  startCleanup(intervalMs = 300_000): NodeJS.Timeout {
    return setInterval(() => this.mem.cleanup(this.windowMs), intervalMs);
  }
}

// ─────────────────────────────────────────────────────────────
// Pre-configured limiters
// ─────────────────────────────────────────────────────────────

export const agentLimiter   = new RateLimiter({ maxRequests: 10,  windowMs: 60_000 });
export const sandboxLimiter = new RateLimiter({ maxRequests: 5,   windowMs: 60_000 });
export const mcpLimiter     = new RateLimiter({ maxRequests: 30,  windowMs: 60_000 });
export const authLimiter    = new RateLimiter({ maxRequests: 5,   windowMs: 60_000 });
export const uploadLimiter  = new RateLimiter({ maxRequests: 10,  windowMs: 60_000 });
