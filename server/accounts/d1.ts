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
      run(): Promise<{ success: boolean }>;
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
    };
  };
  batch(
    statements: {
      bind(...args: unknown[]): {
        run(): Promise<{ success: boolean }>;
        all<T>(): Promise<{ results: T[] }>;
        first<T>(): Promise<T | null>;
      };
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
export function createD1Store(db: D1Like): AccountsStore {
  return {
    async list(owner) {
      const { results } = await db
        .prepare(
          'SELECT network, address, label, created_at, updated_at FROM tracked_addresses WHERE owner_issuer_subject = ?1 ORDER BY network, created_at',
        )
        .bind(owner)
        .all<Row>();
      return results.map(toEntry);
    },
    async add(owner, rawEntry, now) {
      const entry = normEntry(rawEntry);
      const res = await db
        .prepare(
          `INSERT INTO tracked_addresses (owner_issuer_subject, network, address, label, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?5
           WHERE (SELECT COUNT(*) FROM tracked_addresses WHERE owner_issuer_subject = ?1 AND network = ?2) < ${MAX_PER_NETWORK}
           ON CONFLICT (owner_issuer_subject, network, address)
           DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at`,
        )
        .bind(owner, entry.network, entry.address, entry.label, now)
        .run();
      if (!res.success) return { ok: false, reason: 'cap' };
      const row = await db
        .prepare(
          'SELECT network, address, label, created_at, updated_at FROM tracked_addresses WHERE owner_issuer_subject = ?1 AND network = ?2 AND address = ?3',
        )
        .bind(owner, entry.network, entry.address)
        .first<Row>();
      if (!row) return { ok: false, reason: 'cap' };
      return { ok: true, entry: toEntry(row) };
    },
    async remove(owner, network, address) {
      await db
        .prepare(
          'DELETE FROM tracked_addresses WHERE owner_issuer_subject = ?1 AND network = ?2 AND address = ?3',
        )
        .bind(owner, network, network === 'ethereum' ? address.toLowerCase() : address)
        .run();
    },
    async clear(owner) {
      await db
        .prepare('DELETE FROM tracked_addresses WHERE owner_issuer_subject = ?1')
        .bind(owner)
        .run();
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
