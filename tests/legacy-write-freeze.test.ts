import { describe, expect, it } from 'vitest';
import { createD1Store, type D1Like } from '../server/accounts/d1';
import { createSqliteD1 } from './helpers/d1-sqlite';

// Freeze-writes-on-claim-start (ACCOUNT_CLAIM_DESIGN.md section 4): the legacy write paths
// (add/remove/clear) carry the in-statement guard AND NOT EXISTS(claims_ledger state='claimed'),
// serializing writes against the claim at the database. Adapter-level evidence only.
const A = 'https://team.cloudflareaccess.com#user-a';
const ETH = `0x${'1'.repeat(40)}`;
const ETH2 = `0x${'3'.repeat(40)}`;

async function ledger(db: ReturnType<typeof createSqliteD1>['db'], id: string, ownerKey: string, state: string) {
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES (?, 'active', 't0', 't0')").bind(`u-${id}`).run();
  await db
    .prepare('INSERT INTO claims_ledger (id, owner_key, user_id, state, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, ownerKey, `u-${id}`, state, 't2')
    .run();
}

describe('legacy write freeze while a claim is claimed (design section 4)', () => {
  it('frozen add is reported frozen - never cap - and writes nothing', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    await store.add(A, { network: 'ethereum', address: ETH, label: 'x' }, 't1');
    await ledger(db, 'att-1', A, 'claimed');
    const res = await store.add(A, { network: 'ethereum', address: ETH2, label: 'y' }, 't3');
    expect(res).toEqual({ ok: false, reason: 'frozen' });
    const rows = await db.prepare('SELECT COUNT(*) AS n FROM tracked_addresses WHERE owner_issuer_subject = ?1').bind(A).first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it('frozen relabel of an existing row is also frozen; the old label stands', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    await store.add(A, { network: 'ethereum', address: ETH, label: 'old' }, 't1');
    await ledger(db, 'att-1', A, 'claimed');
    const res = await store.add(A, { network: 'ethereum', address: ETH, label: 'new' }, 't3');
    expect(res).toEqual({ ok: false, reason: 'frozen' });
    const row = await db.prepare('SELECT label FROM tracked_addresses WHERE owner_issuer_subject = ?1 AND network = ?2 AND address = ?3').bind(A, 'ethereum', ETH).first<{ label: string }>();
    expect(row?.label).toBe('old');
  });

  it('frozen remove and clear SIGNAL frozen and retain the rows', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    await store.add(A, { network: 'ethereum', address: ETH, label: 'x' }, 't1');
    await store.add(A, { network: 'ethereum', address: ETH2, label: 'y' }, 't1');
    await ledger(db, 'att-1', A, 'claimed');
    expect(await store.remove(A, 'ethereum', ETH)).toEqual({ ok: false, reason: 'frozen' });
    let n = (await db.prepare('SELECT COUNT(*) AS n FROM tracked_addresses WHERE owner_issuer_subject = ?1').bind(A).first<{ n: number }>())?.n;
    expect(n).toBe(2);
    expect(await store.clear(A)).toEqual({ ok: false, reason: 'frozen' });
    n = (await db.prepare('SELECT COUNT(*) AS n FROM tracked_addresses WHERE owner_issuer_subject = ?1').bind(A).first<{ n: number }>())?.n;
    expect(n).toBe(2);
  });

  it('genuinely absent remove/clear stay idempotent ok (no claim exists)', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    expect(await store.remove(A, 'ethereum', ETH)).toEqual({ ok: true });
    expect(await store.clear(A)).toEqual({ ok: true });
  });

  it('genuinely absent remove under an UNRELATED owner claim stays idempotent ok', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    const B = 'https://team.cloudflareaccess.com#user-b';
    await ledger(db, 'att-1', B, 'claimed');
    expect(await store.remove(A, 'ethereum', ETH)).toEqual({ ok: true });
  });

  it('rollback lifts the freeze: add and remove work again', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    await store.add(A, { network: 'ethereum', address: ETH, label: 'x' }, 't1');
    await ledger(db, 'att-1', A, 'rolled_back');
    const res = await store.add(A, { network: 'ethereum', address: ETH2, label: 'y' }, 't3');
    expect(res.ok).toBe(true);
    await store.remove(A, 'ethereum', ETH);
    const n = (await db.prepare('SELECT COUNT(*) AS n FROM tracked_addresses WHERE owner_issuer_subject = ?1').bind(A).first<{ n: number }>())?.n;
    expect(n).toBe(1);
  });

  it('cap is still reported cap (not frozen) when no claim exists', async () => {
    const { db } = createSqliteD1();
    const store = createD1Store(db);
    for (let i = 0; i < 5; i += 1) {
      await store.add(A, { network: 'ethereum', address: `0x${String(i + 1).repeat(40)}`, label: `x${i}` }, 't');
    }
    const res = await store.add(A, { network: 'ethereum', address: `0x${'9'.repeat(40)}`, label: 'over' }, 't');
    expect(res).toEqual({ ok: false, reason: 'cap' });
  });
});

// Controlled-adapter regressions (reviewer requirement): zero-change + row-RETAINED + no
// active claim cannot be produced by a correctly working real adapter (the in-statement
// guard would have deleted the row), so a mock D1 drives the adapter through that window
// directly. The contract: the adapter answers a bounded REJECTION, never a false success,
// and claim state only picks WHICH rejection.
function mockD1(opts: { rowPresent: boolean; rowCount: number; claimed: boolean }): D1Like {
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          void _args;
          return {
            async run() {
              return { success: true, meta: { changes: 0 } }; // guarded write rejected
            },
            async all<T>() {
              return { results: [] as T[] };
            },
            async first<T>(): Promise<T | null> {
              if (sql.includes('claims_ledger')) return (opts.claimed ? { x: 1 } : null) as unknown as T | null;
              if (sql.includes('COUNT(*)')) return { n: opts.rowCount } as unknown as T;
              return (opts.rowPresent ? { x: 1 } : null) as unknown as T | null;
            },
          };
        },
      };
    },
    async batch() {
      return [];
    },
  };
}

describe('zero-change classification regressions (controlled adapter)', () => {
  it('remove with the row RETAINED and no active claim -> storage_error, never false success', async () => {
    const store = createD1Store(mockD1({ rowPresent: true, rowCount: 1, claimed: false }));
    expect(await store.remove(A, 'ethereum', ETH)).toEqual({ ok: false, reason: 'storage_error' });
  });
  it('remove with the row retained under a claim -> frozen (claim state picks the reason only)', async () => {
    const store = createD1Store(mockD1({ rowPresent: true, rowCount: 1, claimed: true }));
    expect(await store.remove(A, 'ethereum', ETH)).toEqual({ ok: false, reason: 'frozen' });
  });
  it('remove genuinely absent -> ok even when the mock reports zero changes', async () => {
    const store = createD1Store(mockD1({ rowPresent: false, rowCount: 0, claimed: false }));
    expect(await store.remove(A, 'ethereum', ETH)).toEqual({ ok: true });
  });
  it('clear with rows RETAINED and no active claim -> storage_error, never false success', async () => {
    const store = createD1Store(mockD1({ rowPresent: true, rowCount: 2, claimed: false }));
    expect(await store.clear(A)).toEqual({ ok: false, reason: 'storage_error' });
  });
  it('clear with rows retained under a claim -> frozen', async () => {
    const store = createD1Store(mockD1({ rowPresent: true, rowCount: 2, claimed: true }));
    expect(await store.clear(A)).toEqual({ ok: false, reason: 'frozen' });
  });
  it('clear on an empty owner -> ok even when the mock reports zero changes', async () => {
    const store = createD1Store(mockD1({ rowPresent: false, rowCount: 0, claimed: false }));
    expect(await store.clear(A)).toEqual({ ok: true });
  });
});
