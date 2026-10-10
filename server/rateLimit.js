/**
 * VOUCH-4 — in-memory rate limiting.
 *
 * A dependency-free fixed-window limiter keyed by client IP. This is a
 * deliberately small piece of infrastructure for a prototype: no Redis, no
 * distributed state, because a single-process demo has no need for either and
 * pulling in a dependency for something this size would go against the
 * project's existing style (the server has exactly two runtime dependencies
 * today — express and cors).
 *
 * In production this is one Espresso/Redis-backed limiter shared across all
 * service instances, per IMPLEMENTATION.md's "no new technology" principle —
 * the interface below (`allow(key)`) is intentionally the same shape that
 * swap would need.
 */

/** @param {() => number} clock injectable for deterministic tests */
export function createLimiter({ windowMs, max, clock = Date.now }) {
  const hits = new Map(); // key -> { count, resetAt }

  // Bound memory: an unbounded Map keyed by attacker-controlled IPs is itself
  // a resource-exhaustion vector. Sweep expired entries opportunistically.
  function sweep(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return {
    /** Returns {allowed, remaining, resetAt}. Never throws. */
    allow(key) {
      const now = clock();
      if (hits.size > 10_000) sweep(now);

      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;

      return { allowed: entry.count <= max, remaining: Math.max(0, max - entry.count), resetAt: entry.resetAt };
    },
    /** Test/ops hook — not used on the request path. */
    reset() {
      hits.clear();
    },
    size() {
      return hits.size;
    },
  };
}

/**
 * Express middleware factory. Two named presets are used in index.js:
 * a generous one for reads, a stricter one for writes — the endpoints that
 * actually mutate state (sending a referral, reporting an account) are the
 * ones worth protecting more tightly against a scripted burst.
 */
export function rateLimitMiddleware(limiter, { name = 'default' } = {}) {
  return (req, res, next) => {
    // req.ip respects Express's trust-proxy setting; falls back to the raw
    // socket address so this still works with no proxy in front of it, which
    // is the prototype's actual deployment shape.
    const key = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const { allowed, remaining, resetAt } = limiter.allow(key);

    res.setHeader('X-RateLimit-Limit-Scope', name);
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (!allowed) {
      const retryAfterSec = Math.ceil((resetAt - Date.now()) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
      return res.status(429).json({
        ok: false,
        error: `Too many requests. Try again in ${Math.max(1, retryAfterSec)}s.`,
      });
    }
    next();
  };
}
