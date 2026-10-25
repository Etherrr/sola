/**
 * Per-identity fixed-window rate limiter. First layer is per-isolate (in-memory): a real
 * bound against a single instance, NOT a global limit; the durable global counter reuses the
 * approved D1 binding. Keys are verified identity strings (iss#sub), never emails or tokens.
 */
export type LimitWindow = { limit: number; windowMs: number };
export type LimitCheck = { allowed: true } | { allowed: false; retryAfterSec: number };

const MAX_KEYS = 10_000;

export function createLimiter(windows: LimitWindow[], now: () => number = Date.now) {
  type Bucket = { count: number; resetAt: number };
  const state = new Map<string, Bucket[]>(); // key -> one bucket per window

  function check(key: string): LimitCheck {
    const t = now();
    let buckets = state.get(key);
    if (!buckets) {
      if (state.size >= MAX_KEYS) {
        // Bounded memory: drop fully expired entries first; refuse new keys only when all are live.
        for (const [k, bs] of state) {
          if (bs.every((b) => b.resetAt <= t)) state.delete(k);
        }
        if (state.size >= MAX_KEYS) return { allowed: false, retryAfterSec: 60 };
      }
      buckets = windows.map((w) => ({ count: 0, resetAt: t + w.windowMs }));
      state.set(key, buckets);
    }
    let retryAfterSec = 0;
    for (let i = 0; i < windows.length; i += 1) {
      const b = buckets[i];
      if (b.resetAt <= t) {
        b.count = 0;
        b.resetAt = t + windows[i].windowMs;
      }
      if (b.count >= windows[i].limit) {
        retryAfterSec = Math.max(retryAfterSec, Math.ceil((b.resetAt - t) / 1000));
      }
    }
    if (retryAfterSec > 0) return { allowed: false, retryAfterSec };
    for (const b of buckets) b.count += 1;
    return { allowed: true };
  }
  return { check };
}

/** Proposed defaults for the read-only lookup: 10/minute and 100/day per verified identity. */
export const LOOKUP_WINDOWS: LimitWindow[] = [
  { limit: 10, windowMs: 60_000 },
  { limit: 100, windowMs: 86_400_000 },
];
/** Proposed defaults for account-list mutations. */
export const MUTATION_WINDOWS: LimitWindow[] = [{ limit: 30, windowMs: 60_000 }];
