/**
 * rate-limiter.ts — In-memory sliding-window rate limiter
 *
 * Prevents API abuse and controls LLM cost by capping requests per user.
 *
 * Usage:
 *   const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });
 *   const result  = limiter.check("user-123");
 *   if (!result.allowed) throw new Error(result.message);
 */

export interface RateLimiterOptions {
  /** Maximum number of requests allowed within the window */
  maxRequests: number;
  /** Time window in milliseconds (default: 60 000 = 1 minute) */
  windowMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  message?: string;
}

interface WindowEntry {
  timestamps: number[];
}

// ─────────────────────────────────────────────────────────────
// Sliding-window rate limiter
// ─────────────────────────────────────────────────────────────
export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly store = new Map<string, WindowEntry>();

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs    = options.windowMs ?? 60_000;
  }

  /**
   * Check and record a request for a given key (userId, IP, etc.)
   * Returns whether the request is allowed and remaining quota.
   */
  check(key: string): RateLimitResult {
    const now    = Date.now();
    const cutoff = now - this.windowMs;

    const entry = this.store.get(key) ?? { timestamps: [] };

    // Evict timestamps outside the current window
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);

    if (entry.timestamps.length >= this.maxRequests) {
      const oldest   = entry.timestamps[0];
      const resetInMs = this.windowMs - (now - oldest);
      const resetSec  = Math.ceil(resetInMs / 1000);

      return {
        allowed:   false,
        remaining: 0,
        resetInMs,
        message: `Rate limit exceeded. Try again in ${resetSec}s (limit: ${this.maxRequests} req/${this.windowMs / 1000}s).`,
      };
    }

    // Record this request
    entry.timestamps.push(now);
    this.store.set(key, entry);

    return {
      allowed:   true,
      remaining: this.maxRequests - entry.timestamps.length,
      resetInMs: this.windowMs,
    };
  }

  /** Reset the counter for a specific key */
  reset(key: string): void {
    this.store.delete(key);
  }

  /** Current usage stats for a key */
  stats(key: string): { requests: number; remaining: number } {
    const now    = Date.now();
    const cutoff = now - this.windowMs;
    const entry  = this.store.get(key);
    const count  = entry?.timestamps.filter(t => t > cutoff).length ?? 0;
    return { requests: count, remaining: Math.max(0, this.maxRequests - count) };
  }

  /** Periodic cleanup to free memory for inactive users */
  startCleanup(intervalMs = 300_000): NodeJS.Timeout {
    return setInterval(() => {
      const now    = Date.now();
      const cutoff = now - this.windowMs;
      for (const [key, entry] of this.store.entries()) {
        const active = entry.timestamps.filter(t => t > cutoff);
        if (active.length === 0) {
          this.store.delete(key);
        } else {
          entry.timestamps = active;
        }
      }
    }, intervalMs);
  }
}

// ─────────────────────────────────────────────────────────────
// Pre-configured limiters for the application
// ─────────────────────────────────────────────────────────────

/** General agent requests: 10 per minute per user */
export const agentLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });

/** Sandbox (E2B) execution: 5 per minute per user — more expensive */
export const sandboxLimiter = new RateLimiter({ maxRequests: 5, windowMs: 60_000 });

/** MCP tool calls: 30 per minute per user */
export const mcpLimiter = new RateLimiter({ maxRequests: 30, windowMs: 60_000 });
