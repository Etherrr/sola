// Test-only D1Like implementation over real SQLite (node:sqlite), executing the ACTUAL
// migration file and the adapter's real SQL. This is D1-compatible execution semantics for
// the statements used (SQLite), still not a workerd D1 binding.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { D1Like } from '../../server/accounts/d1';

export function createSqliteD1(): { db: D1Like; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const migration = readFileSync(
    resolve(__dirname, '../../migrations/0001_accounts_and_counters.sql'),
    'utf8',
  );
  raw.exec(migration);
  const db: D1Like = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const stmt = raw.prepare(sql);
          const norm = args.map((a) => (typeof a === 'boolean' ? (a ? 1 : 0) : (a as never)));
          return {
            async run() {
              stmt.run(...norm);
              return { success: true };
            },
            async all<T>() {
              return { results: stmt.all(...norm) as T[] };
            },
            async first<T>() {
              const row = stmt.get(...norm);
              return (row ?? null) as T | null;
            },
          };
        },
      };
    },
    async batch() {
      return [];
    },
  };
  return { db, raw };
}
