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

  it('relabels an existing address even when the owner is AT the per-network cap (finding 1)', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    const first = `0x${'0'.repeat(39)}1`;
    await store.add(A, { network: 'ethereum', address: first, label: 'old' }, 't1');
    for (let i = 1; i < MAX_PER_NETWORK; i += 1) {
      await store.add(A, { network: 'ethereum', address: `0x${String(i + 1).repeat(40)}`, label: `x${i}` }, 't');
    }
    expect((await store.list(A)).filter((r) => r.network === 'ethereum')).toHaveLength(MAX_PER_NETWORK);
    // At cap: relabeling an EXISTING row succeeds and returns the new label (was: silent old label).
    const relabel = await store.add(A, { network: 'ethereum', address: first, label: 'new' }, 't2');
    expect(relabel.ok && relabel.entry.label).toBe('new');
    expect(relabel.ok && relabel.entry.createdAt).toBe('t1');
    // At cap: a genuinely NEW address is still rejected.
    const over = await store.add(A, { network: 'ethereum', address: `0x${'9'.repeat(40)}`, label: 'over' }, 't');
    expect(over).toEqual({ ok: false, reason: 'cap' });
    expect((await store.list(A)).filter((r) => r.network === 'ethereum')).toHaveLength(MAX_PER_NETWORK);
  });

  it('resolves concurrent adds of the SAME new address as an upsert, never a UNIQUE error (finding 7)', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    const addr = `0x${'c'.repeat(40)}`;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        store.add(A, { network: 'ethereum', address: addr, label: `x${i}` }, `t${i}`),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true); // no 500-equivalent, no cap, no throw
    const rows = await store.list(A);
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toBe('t0'); // created_at preserved from the first write
    expect(rows[0].label).toBe('x5'); // last writer wins
  });
  it('at the cap, concurrent adds of an EXISTING address upsert without growing rows (finding 7 at cap)', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    const addr = `0x${'d'.repeat(40)}`;
    await store.add(A, { network: 'ethereum', address: addr, label: 'old' }, 't0');
    for (let i = 1; i < MAX_PER_NETWORK; i += 1) {
      await store.add(A, { network: 'ethereum', address: `0x${String(i + 1).repeat(40)}`, label: `x${i}` }, 't');
    }
    const results = await Promise.all([
      store.add(A, { network: 'ethereum', address: addr, label: 'z0' }, 'u0'),
      store.add(A, { network: 'ethereum', address: addr, label: 'z1' }, 'u1'),
      store.add(A, { network: 'ethereum', address: addr, label: 'z2' }, 'u2'),
      store.add(A, { network: 'ethereum', address: `0x${'9'.repeat(40)}`, label: 'new' }, 'u3'),
    ]);
    expect(results.slice(0, 3).every((r) => r.ok)).toBe(true); // relabels at cap succeed
    expect(results[3]).toEqual({ ok: false, reason: 'cap' }); // genuinely new address still capped
    const rows = (await store.list(A)).filter((r) => r.network === 'ethereum');
    expect(rows).toHaveLength(MAX_PER_NETWORK);
    expect(rows.find((r) => r.address === addr)).toMatchObject({ label: 'z2', createdAt: 't0' });
  });
  it('storage failures never masquerade as cap: bounded storage reason (finding 7 contract)', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    const entry = { network: 'ethereum' as const, address: `0x${'e'.repeat(40)}`, label: 'x' };
    // run() rejects (closed db): storage, not cap, no throw.
    const { db: dead, raw } = createSqliteD1();
    raw.close();
    const deadStore = createD1Store(dead);
    await expect(deadStore.add(A, entry, 't')).resolves.toEqual({ ok: false, reason: 'storage' });
    // run() reports success:false: storage, not cap.
    const failing = {
      prepare: () => ({
        bind: () => ({
          run: async () => ({ success: false }),
          all: async () => ({ results: [] }),
          first: async () => null,
        }),
      }),
      batch: async () => [],
    };
    const failStore = createD1Store(failing as never);
    await expect(failStore.add(A, entry, 't')).resolves.toEqual({ ok: false, reason: 'storage' });
    // Sanity: the real store still works.
    expect((await store.add(A, entry, 't')).ok).toBe(true);
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
    const lim = createD1Limiter(db, [{ limit: 3, windowMs: 86_400_000 }], 'lookup', () => t);
    expect((await lim.check(A)).allowed).toBe(true);
    expect((await lim.check(A)).allowed).toBe(true);
    expect((await lim.check(A)).allowed).toBe(true);
    const blocked = await lim.check(A);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSec).toBe(12 * 3600); // until UTC midnight
    // Raw SQL confirms exactly one row with count 4 for that UTC window.
    const rows = raw.prepare('SELECT scope, owner, window_start, count FROM rate_counters').all() as never[];
    expect(rows).toEqual([{ scope: 'lookup', owner: A, window_start: day0, count: 4 }]);
    // A different owner is independent; a new UTC day resets.
    expect((await lim.check(B)).allowed).toBe(true);
    t = day0 + 86_400_000 + 1;
    expect((await lim.check(A)).allowed).toBe(true);
  });
  it('fails closed on storage errors and sweep removes only closed windows', async () => {
    const { db, raw } = createSqliteD1();
    const t = Date.UTC(2026, 9, 24);
    const lim = createD1Limiter(db, [{ limit: 1, windowMs: 60_000 }], 'mutation', () => t);
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
      .prepare('INSERT INTO rate_counters (scope, owner, window_start, window_ms, count) VALUES (?, ?, ?, ?, ?)')
      .run('mutation', A, nowReal - 3 * 86_400_000, 60_000, 5);
    raw2
      .prepare('INSERT INTO rate_counters (scope, owner, window_start, window_ms, count) VALUES (?, ?, ?, ?, ?)')
      .run('mutation', A, nowReal - 30_000, 60_000, 1);
    const lim2 = createD1Limiter(db2, [{ limit: 1, windowMs: 60_000 }], 'mutation', () => nowReal);
    await lim2.sweep(2 * 86_400_000);
    const left = raw2.prepare('SELECT count FROM rate_counters').all() as { count: number }[];
    expect(left).toEqual([{ count: 1 }]);
  });

  it('keeps lookup and mutation scopes independent for the same owner and window (finding 2)', async () => {
    const { db, raw } = createSqliteD1();
    const t = Date.UTC(2026, 9, 24, 12, 0, 0);
    const w = [{ limit: 1, windowMs: 60_000 }];
    const lookup = createD1Limiter(db, w, 'lookup', () => t);
    const mutation = createD1Limiter(db, w, 'mutation', () => t);
    expect((await lookup.check(A)).allowed).toBe(true);
    expect((await lookup.check(A)).allowed).toBe(false); // lookup window exhausted
    expect((await mutation.check(A)).allowed).toBe(true); // mutation scope untouched
    expect((await mutation.check(A)).allowed).toBe(false);
    const rows = raw
      .prepare('SELECT scope, count FROM rate_counters ORDER BY scope')
      .all() as { scope: string; count: number }[];
    expect(rows).toEqual([
      { scope: 'lookup', count: 2 },
      { scope: 'mutation', count: 2 },
    ]);
  });
  it('sweep removes closed windows in EVERY scope and keeps live ones (finding 3)', async () => {
    const { db, raw } = createSqliteD1();
    const nowReal = Date.now();
    const ins = raw.prepare(
      'INSERT INTO rate_counters (scope, owner, window_start, window_ms, count) VALUES (?, ?, ?, ?, ?)',
    );
    ins.run('lookup', A, nowReal - 3 * 86_400_000, 60_000, 9);
    ins.run('mutation', A, nowReal - 3 * 86_400_000, 60_000, 9);
    ins.run('lookup', A, nowReal - 30_000, 60_000, 1);
    ins.run('mutation', A, nowReal - 30_000, 60_000, 1);
    const lim = createD1Limiter(db, [{ limit: 1, windowMs: 60_000 }], 'lookup', () => nowReal);
    await lim.sweep(2 * 86_400_000);
    const left = raw.prepare('SELECT scope, count FROM rate_counters ORDER BY scope').all() as {
      scope: string;
      count: number;
    }[];
    expect(left).toEqual([
      { scope: 'lookup', count: 1 },
      { scope: 'mutation', count: 1 },
    ]);
  });
});
