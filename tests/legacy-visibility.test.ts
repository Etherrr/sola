import { describe, expect, it } from 'vitest';
import { createD1Store } from '../server/accounts/d1';
import { createSqliteD1 } from './helpers/d1-sqlite';

// Legacy-visibility read path (ACCOUNT_CLAIM_DESIGN.md section 6, minimal protocol):
// the legacy list hides an owner's rows only while a claims_ledger row for that owner key
// is in state 'claimed'; 'rolled_back' does NOT re-hide; rows are retained, never deleted.
// Runs on the real SQLite adapter against the real post-0004 schema (0004 applied by the helper).
// Adapter-level evidence only - the same statements still owe their actual-D1 proof (REHEARSAL-1).

const A = 'https://team.cloudflareaccess.com#user-a';
const B = 'https://team.cloudflareaccess.com#user-b';
const ETH = `0x${'1'.repeat(40)}`;
const SOL = 'So1DemoAddr9zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

async function seed(db: ReturnType<typeof createSqliteD1>['db']) {
  const store = createD1Store(db);
  await store.add(A, { network: 'ethereum', address: ETH, label: 'a-eth' }, 't1');
  await store.add(A, { network: 'solana', address: SOL, label: 'a-sol' }, 't1');
  await store.add(B, { network: 'ethereum', address: `0x${'2'.repeat(40)}`, label: 'b-eth' }, 't1');
  return store;
}

async function ledger(db: ReturnType<typeof createSqliteD1>['db'], id: string, ownerKey: string, state: string) {
  // claims_ledger.user_id FK: insert a minimal users row first.
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES (?, 'active', 't0', 't0')").bind(`u-${id}`).run();
  await db
    .prepare('INSERT INTO claims_ledger (id, owner_key, user_id, state, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, ownerKey, `u-${id}`, state, 't2')
    .run();
}

describe('legacy read path hides only on claimed (design section 6)', () => {
  it('returns rows when no ledger row exists for the owner key', async () => {
    const { db } = createSqliteD1();
    const store = await seed(db);
    const rows = await store.list(A);
    expect(rows).toHaveLength(2);
  });

  it('hides every legacy row for the owner while state is claimed; rows are retained, not deleted', async () => {
    const { db, raw } = createSqliteD1();
    const store = await seed(db);
    await ledger(db, 'att-1', A, 'claimed');
    expect(await store.list(A)).toHaveLength(0);
    const retained = raw.prepare('SELECT COUNT(*) AS n FROM tracked_addresses WHERE owner_issuer_subject = ?').get(A) as { n: number };
    expect(retained.n).toBe(2);
  });

  it('a rolled_back ledger row does NOT re-hide', async () => {
    const { db } = createSqliteD1();
    const store = await seed(db);
    await ledger(db, 'att-1', A, 'rolled_back');
    expect(await store.list(A)).toHaveLength(2);
  });

  it('claim on one owner never hides another owner', async () => {
    const { db } = createSqliteD1();
    const store = await seed(db);
    await ledger(db, 'att-1', A, 'claimed');
    expect(await store.list(A)).toHaveLength(0);
    expect(await store.list(B)).toHaveLength(1);
  });

  it('a fresh claim after rollback re-hides (reclaim path)', async () => {
    const { db } = createSqliteD1();
    const store = await seed(db);
    await ledger(db, 'att-1', A, 'rolled_back');
    await ledger(db, 'att-2', A, 'claimed');
    expect(await store.list(A)).toHaveLength(0);
  });
});
