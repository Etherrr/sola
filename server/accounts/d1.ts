import {
  MAX_LABEL,
  MAX_PER_NETWORK,
  normEntry,
  type AccountsStore,
  type Network,
  type TrackedAddress,
} from './store';

/**
 * Minimal slice of the Cloudflare D1 prepared-statement API used here, so the adapter can be
 * type-checked without the workerd types. UNTESTED until a binding is approved and created;
 * the memory store is the tested reference for identical semantics.
 */
export type D1Like = {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
    };
  };
  // Callers pass BOUND statements (the result of prepare(sql).bind(...)), as
  // with the real D1 API; batch commits them atomically.
  batch(
    statements: {
      run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
    }[],
  ): Promise<unknown[]>;
};

type Row = {
  network: string;
  address: string;
  label: string;
  created_at: string;
  updated_at: string;
};
const toEntry = (r: Row): TrackedAddress => ({
  network: r.network as Network,
  address: r.address,
  label: r.label,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * D1-backed store. EVERY statement carries the owner predicate; there is no query path that
 * reads or writes another owner's rows. The cap is enforced inside the INSERT's own SELECT
 * (one atomic statement), never an application count-then-insert race. Add is idempotent on
 * the unique (owner, network, address) key and updates label on conflict.
 */
/**
 * ADVISORY claimed-state read for user-facing rejection-reason classification ONLY - never
 * a control, and never evidence FOR success: row presence/absence decides success, this read
 * only chooses between 'frozen' and 'storage_error' on an already-established rejection.
 */
async function isClaimed(db: D1Like, owner: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM claims_ledger WHERE owner_key = ?1 AND state = 'claimed'")
    .bind(owner)
    .first<{ x: number }>();
  return row !== null;
}

export function createD1Store(db: D1Like): AccountsStore {
  return {
    async list(owner) {
      // State-derived legacy hiding (ACCOUNT_CLAIM_DESIGN.md section 6): once a claim for this
      // owner key is in state 'claimed', the legacy rows stay stored but stop being read here;
      // a 'rolled_back' row does NOT re-hide. DEPLOYMENT ORDER: requires claims_ledger
      // (migration 0004) applied BEFORE this code runs - the read path breaks without it.
      const { results } = await db
        .prepare(
          `SELECT network, address, label, created_at, updated_at FROM tracked_addresses
             WHERE owner_issuer_subject = ?1
               AND NOT EXISTS (SELECT 1 FROM claims_ledger WHERE owner_key = ?1 AND state = 'claimed')
             ORDER BY network, created_at`,
        )
        .bind(owner)
        .all<Row>();
      return results.map(toEntry);
    },
    async add(owner, rawEntry, now) {
      const entry = normEntry(rawEntry);
      // ONE atomic statement, no count-then-insert or update-then-insert race:
      //  - new row under the cap: inserted;
      //  - existing row (any cap state): the OR EXISTS clause admits the attempt and the
      //    UPSERT relabels it, preserving created_at (reviewer findings 1 and 7 —
      //    concurrent same-key adds resolve as last-writer-wins, never an unhandled
      //    UNIQUE error);
      //  - new row AT the cap: both conditions false, zero rows, reported as 'cap'.
      // Storage failures are NEVER reported as 'cap' (bounded 503 contract upstream).
      try {
        const res = await db
          .prepare(
            `INSERT INTO tracked_addresses (owner_issuer_subject, network, address, label, created_at, updated_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?5
             WHERE NOT EXISTS (SELECT 1 FROM claims_ledger WHERE owner_key = ?1 AND state = 'claimed')
               AND ((SELECT COUNT(*) FROM tracked_addresses WHERE owner_issuer_subject = ?1 AND network = ?2) < ${MAX_PER_NETWORK}
                OR EXISTS (SELECT 1 FROM tracked_addresses WHERE owner_issuer_subject = ?1 AND network = ?2 AND address = ?3))
             ON CONFLICT (owner_issuer_subject, network, address) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at`,
          )
          .bind(owner, entry.network, entry.address, entry.label, now)
          .run();
        if (!res.success) return { ok: false, reason: 'storage' };
        if (res.meta?.changes !== 1) {
          // Zero changes now means cap OR an active claim froze legacy writes (design section 4).
          // Report each honestly; a freeze is NEVER reported as 'cap'. The in-statement guard is
          // the authoritative control; this post-hoc classification is ADVISORY (a rollback or
          // fresh claim can intervene between the write and this read) and exists only to pick
          // the honest user-facing reason.
          const frozen = await isClaimed(db, owner);
          if (frozen) return { ok: false, reason: 'frozen' };
          return { ok: false, reason: 'cap' };
        }
        const row = await db
          .prepare(
            'SELECT network, address, label, created_at, updated_at FROM tracked_addresses WHERE owner_issuer_subject = ?1 AND network = ?2 AND address = ?3',
          )
          .bind(owner, entry.network, entry.address)
          .first<Row>();
        if (!row) return { ok: false, reason: 'storage' };
        return { ok: true, entry: toEntry(row) };
      } catch {
        return { ok: false, reason: 'storage' };
      }
    },
    async remove(owner, network, address) {
      const key = network === 'ethereum' ? address.toLowerCase() : address;
      const res = await db
        .prepare(
          `DELETE FROM tracked_addresses WHERE owner_issuer_subject = ?1 AND network = ?2 AND address = ?3
             AND NOT EXISTS (SELECT 1 FROM claims_ledger WHERE owner_key = ?1 AND state = 'claimed')`,
        )
        .bind(owner, network, key)
        .run();
      if (res.meta?.changes !== 0) return { ok: true };
      // Zero changes: re-read the TARGET ROW - the row, never claim state, decides success.
      // Absent is a genuine idempotent no-op; PRESENT means the guarded write was rejected,
      // which can never be reported as success (a rollback landing between the write and this
      // read must not yield a false 200 over a retained row). Claim state only picks the
      // honest rejection reason and stays ADVISORY: a bounded misclassification changes WHICH
      // rejection the caller sees, never turns a retained row into success.
      const stillThere = await db
        .prepare(
          `SELECT 1 AS x FROM tracked_addresses WHERE owner_issuer_subject = ?1 AND network = ?2 AND address = ?3`,
        )
        .bind(owner, network, key)
        .first<{ x: number }>();
      if (!stillThere) return { ok: true };
      return (await isClaimed(db, owner))
        ? { ok: false, reason: 'frozen' }
        : { ok: false, reason: 'storage_error' };
    },
    async clear(owner) {
      const res = await db
        .prepare(
          `DELETE FROM tracked_addresses WHERE owner_issuer_subject = ?1
             AND NOT EXISTS (SELECT 1 FROM claims_ledger WHERE owner_key = ?1 AND state = 'claimed')`,
        )
        .bind(owner)
        .run();
      if (res.meta?.changes !== 0) return { ok: true };
      // Zero changes: re-read the OWNER ROW COUNT - same contract as remove. Zero rows is a
      // genuine idempotent no-op; surviving rows mean the guarded write was rejected and can
      // never be reported as success. Claim state only picks the rejection reason (advisory;
      // bounded misclassification, never a false 200 over retained rows).
      const count = await db
        .prepare(`SELECT COUNT(*) AS n FROM tracked_addresses WHERE owner_issuer_subject = ?1`)
        .bind(owner)
        .first<{ n: number }>();
      if (!count || Number(count.n) === 0) return { ok: true };
      return (await isClaimed(db, owner))
        ? { ok: false, reason: 'frozen' }
        : { ok: false, reason: 'storage_error' };
    },
  };
}

/** Schema applied once at binding-approval time, by the owner-approved migration path. */
export const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS tracked_addresses (
  owner_issuer_subject TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('ethereum', 'solana')),
  address TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND ${MAX_LABEL}),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_issuer_subject, network, address)
);`;

/** Counters for the durable global limiter layer (same binding decision as account storage). */
export const COUNTERS_SQL = `CREATE TABLE IF NOT EXISTS rate_counters (
  scope TEXT NOT NULL,
  owner TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  window_ms INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (scope, owner, window_start, window_ms)
);`;
