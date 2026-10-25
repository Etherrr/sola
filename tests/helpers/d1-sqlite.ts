// Test-only D1Like implementation over real SQLite (node:sqlite), executing the ACTUAL
// migration file and the adapter's real SQL. This is D1-compatible execution semantics for
// the statements used (SQLite), still not a workerd D1 binding.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { D1Like } from '../../server/accounts/d1';

export function createSqliteD1(): { db: D1Like; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  for (const f of ['0001_accounts_and_counters.sql', '0002_native_auth.sql', '0003_portfolio_user_unique.sql']) {
    raw.exec(readFileSync(resolve(__dirname, '../../migrations/' + f), 'utf8'));
  }
  const db: D1Like = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const stmt = raw.prepare(sql);
          const norm = args.map((a) => (typeof a === 'boolean' ? (a ? 1 : 0) : (a as never)));
          return {
            async run() {
              const info = stmt.run(...norm);
              return { success: true, meta: { changes: Number(info.changes) } };
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
    // Real transactional batch: all statements commit together or roll back.
    async batch(stmts: { run(): Promise<unknown> }[]) {
      raw.exec('BEGIN');
      try {
        const out: unknown[] = [];
        for (const st of stmts) out.push(await st.run());
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db, raw };
}
