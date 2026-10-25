import type { D1Like } from './d1';
import type { LimitCheck, LimitWindow } from './limiter';

/**
 * Durable global counter layer for the rate limiter, backed by the SAME approved D1 binding
 * as account storage. Each check is ONE atomic UPSERT ... RETURNING count (single statement:
 * concurrent instances cannot lose an increment). Windows are fixed and UTC-aligned: a day
 * window is a UTC calendar day. Fail CLOSED: any storage error denies the request with a
 * bounded retry delay; a missing/failed guardrail must never silently allow.
 */
export function createD1Limiter(db: D1Like, windows: LimitWindow[], now: () => number = Date.now) {
  async function check(key: string): Promise<LimitCheck> {
    const t = now();
    try {
      let retryAfterSec = 0;
      for (const w of windows) {
        const windowStart = Math.floor(t / w.windowMs) * w.windowMs; // UTC-aligned fixed window
        const row = await db
          .prepare(
            `INSERT INTO rate_counters (owner, window_start, window_ms, count)
             VALUES (?1, ?2, ?3, 1)
             ON CONFLICT (owner, window_start, window_ms) DO UPDATE SET count = count + 1
             RETURNING count`,
          )
          .bind(key, windowStart, w.windowMs)
          .first<{ count: number }>();
        const count = row && typeof row.count === 'number' ? row.count : w.limit + 1; // missing row: fail closed
        if (count > w.limit) {
          retryAfterSec = Math.max(retryAfterSec, Math.ceil((windowStart + w.windowMs - t) / 1000));
        }
      }
      if (retryAfterSec > 0) return { allowed: false, retryAfterSec };
      return { allowed: true };
    } catch {
      return { allowed: false, retryAfterSec: 60 }; // fail closed on any storage error
    }
  }

  /** Lazy bound on table growth: drop windows that closed more than `keepMs` ago. */
  async function sweep(keepMs: number): Promise<void> {
    try {
      await db
        .prepare('DELETE FROM rate_counters WHERE window_start + window_ms < ?1')
        .bind(now() - keepMs)
        .run();
    } catch {
      // A failed sweep is retried on a later call; it never blocks or allows requests by itself.
    }
  }
  return { check, sweep };
}
