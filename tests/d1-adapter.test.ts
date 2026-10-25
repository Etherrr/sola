import { describe, expect, it } from 'vitest';
import { createD1Store } from '../server/accounts/d1';
import { createD1Limiter } from '../server/accounts/d1-limiter';
import { MAX_PER_NETWORK } from '../server/accounts/store';
import { createSqliteD1 } from './helpers/d1-sqlite';

const A = 'https://team.cloudflareaccess.com#user-a';
const B = 'https://team.cloudflareaccess.com#user-b';
const SOL = 'So1DemoAddr9zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

describe('D1 adapter on real SQLite (migration + real adapter SQL)', () => {
  it('enforces the per-network cap atomically under concurrent adds', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    const adds = Array.from({ length: 8 }, (_, i) =>
      store.add(A, { network: 'ethereum', address: `0x${String(i + 1).repeat(40)}`, label: `x${i}` }, 't'),
    );
    const results = await Promise.all(adds); // racing the cap
    expect(results.filter((r) => r.ok)).toHaveLength(MAX_PER_NETWORK);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'cap')).toBe(true);
    expect((await store.list(A)).filter((r) => r.network === 'ethereum')).toHaveLength(MAX_PER_NETWORK);
    // Per-network independence on the real schema.
    expect((await store.add(A, { network: 'solana', address: SOL, label: 's' }, 't')).ok).toBe(true);
  });
  it('isolates owners at the SQL level and normalizes ETH case in the unique key', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    await store.add(A, { network: 'ethereum', address: '0x' + 'A'.repeat(40), label: 'one' }, 't1');
    const again = await store.add(A, { network: 'ethereum', address: '0x' + 'a'.repeat(40), label: 'two' }, 't2');
    expect(again.ok && again.entry.label).toBe('two');
    expect(again.ok && again.entry.createdAt).toBe('t1');
    expect(await store.list(A)).toHaveLength(1);
    // Same address under B is a different row; B cannot see or delete A's data.
    await store.add(B, { network: 'ethereum', address: '0x' + 'a'.repeat(40), label: 'b' }, 't');
    expect(await store.list(B)).toHaveLength(1);
    await store.remove(B, 'ethereum', '0x' + 'a'.repeat(40));
    expect(await store.list(A)).toHaveLength(1);
    expect(await store.list(B)).toHaveLength(0);
    await store.clear(A);
    await store.clear(A);
    expect(await store.list(A)).toHaveLength(0);
  });
});

describe('D1 limiter on real SQLite', () => {
  it('counts atomically per UTC-aligned window and denies over limit with retry delay', async () => {
    const { db, raw } = createSqliteD1();
    const day0 = Date.UTC(2026, 9, 24, 0, 0, 0);
    let t = day0 + 12 * 3_600_000; // noon UTC
    const lim = createD1Limiter(db, [{ limit: 3, windowMs: 86_400_000 }], () => t);
    expect((await lim.check(A)).allowed).toBe(true);
    expect((await lim.check(A)).allowed).toBe(true);
    expect((await lim.check(A)).allowed).toBe(true);
    const blocked = await lim.check(A);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSec).toBe(12 * 3600); // until UTC midnight
    // Raw SQL confirms exactly one row with count 4 for that UTC window.
    const rows = raw.prepare('SELECT owner, window_start, count FROM rate_counters').all() as never[];
    expect(rows).toEqual([{ owner: A, window_start: day0, count: 4 }]);
    // A different owner is independent; a new UTC day resets.
    expect((await lim.check(B)).allowed).toBe(true);
    t = day0 + 86_400_000 + 1;
    expect((await lim.check(A)).allowed).toBe(true);
  });
  it('fails closed on storage errors and sweep removes only closed windows', async () => {
    const { db, raw } = createSqliteD1();
    const t = Date.UTC(2026, 9, 24);
    const lim = createD1Limiter(db, [{ limit: 1, windowMs: 60_000 }], () => t);
    expect((await lim.check(A)).allowed).toBe(true);
    const blocked = await lim.check(A);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSec).toBeGreaterThan(0);
    raw.close();
    const denied = await lim.check(A);
    expect(denied.allowed).toBe(false); // fail closed, not open
    if (!denied.allowed) expect(denied.retryAfterSec).toBe(60);
    // Sweep on a fresh db with an old and a live window.
    const { db: db2, raw: raw2 } = createSqliteD1();
    const nowReal = Date.now();
    raw2
      .prepare('INSERT INTO rate_counters (owner, window_start, window_ms, count) VALUES (?, ?, ?, ?)')
      .run(A, nowReal - 3 * 86_400_000, 60_000, 5);
    raw2
      .prepare('INSERT INTO rate_counters (owner, window_start, window_ms, count) VALUES (?, ?, ?, ?)')
      .run(A, nowReal - 30_000, 60_000, 1);
    const lim2 = createD1Limiter(db2, [{ limit: 1, windowMs: 60_000 }], () => nowReal);
    await lim2.sweep(2 * 86_400_000);
    const left = raw2.prepare('SELECT count FROM rate_counters').all() as { count: number }[];
    expect(left).toEqual([{ count: 1 }]);
  });
});
