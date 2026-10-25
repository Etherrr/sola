// Atomic single-use challenge semantics (docs/V0_2_ARCHITECTURE.md §3).
// Runs against real in-memory SQLite executing the actual 0002 draft migration.
import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';
import {
  claimChallenge,
  getChallengeState,
  issueChallenge,
  recordFailedAttempt,
  type ChallengeDb,
} from '../server/auth/challenges';

function makeDb(): ChallengeDb {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(resolve(__dirname, '../migrations/0001_accounts_and_counters.sql'), 'utf8'));
  raw.exec(readFileSync(resolve(__dirname, '../migrations/0002_native_auth.sql'), 'utf8'));
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const stmt = raw.prepare(sql);
          return {
            async run() {
              const info = stmt.run(...(args as never[]));
              return { success: true, meta: { changes: Number(info.changes) } };
            },
            async all<T>() {
              return { results: stmt.all(...(args as never[])) as T[] };
            },
            async first<T>() {
              return (stmt.get(...(args as never[])) ?? null) as T | null;
            },
          };
        },
      };
    },
  };
}

describe('auth challenges: atomic single-use claims', () => {
  let db: ChallengeDb;
  beforeEach(() => {
    db = makeDb();
  });

  it('issues a challenge storing only the hash', async () => {
    const c = await issueChallenge(db, 'email_code', 'a@b.c', 600_000, new Date('2026-10-25T14:00:00Z'));
    expect(c.secret).toMatch(/^[0-9a-f]{8}$/);
    const st = await getChallengeState(db, 'email_code', 'a@b.c');
    expect(st?.consumed_at).toBeNull();
  });

  it('exactly one claim succeeds; sequential replay adds zero', async () => {
    const now = new Date('2026-10-25T14:00:00Z');
    const c = await issueChallenge(db, 'email_code', 'a@b.c', 600_000, now);
    const first = await claimChallenge(db, 'email_code', 'a@b.c', c.secret, 'attempt-1', now);
    const replay = await claimChallenge(db, 'email_code', 'a@b.c', c.secret, 'attempt-2', now);
    expect(first).toBe(true);
    expect(replay).toBe(false);
    const st = await getChallengeState(db, 'email_code', 'a@b.c');
    expect(st?.claim_attempt_id).toBe('attempt-1');
  });

  it('rejects a wrong secret without consuming (and counts the failure)', async () => {
    const now = new Date('2026-10-25T14:00:00Z');
    const c = await issueChallenge(db, 'email_code', 'a@b.c', 600_000, now);
    expect(await claimChallenge(db, 'email_code', 'a@b.c', 'deadbeef', 'attempt-x', now)).toBe(false);
    await recordFailedAttempt(db, 'email_code', 'a@b.c');
    expect(await claimChallenge(db, 'email_code', 'a@b.c', c.secret, 'attempt-1', now)).toBe(true);
    const st = await getChallengeState(db, 'email_code', 'a@b.c');
    expect(st?.attempts).toBe(1);
  });

  it('rejects an expired challenge', async () => {
    const issued = new Date('2026-10-25T14:00:00Z');
    const c = await issueChallenge(db, 'email_code', 'a@b.c', 600_000, issued);
    const later = new Date(issued.getTime() + 601_000);
    expect(await claimChallenge(db, 'email_code', 'a@b.c', c.secret, 'attempt-1', later)).toBe(false);
  });

  it('crash after claim burns the challenge: no automatic un-consume', async () => {
    const now = new Date('2026-10-25T14:00:00Z');
    const c = await issueChallenge(db, 'wallet_evm', '0xabc', 600_000, now);
    expect(await claimChallenge(db, 'wallet_evm', '0xabc', c.secret, 'attempt-1', now)).toBe(true);
    // simulated crash: session creation never happens; the challenge stays burned.
    expect(await claimChallenge(db, 'wallet_evm', '0xabc', c.secret, 'attempt-1', now)).toBe(false);
    expect(await claimChallenge(db, 'wallet_evm', '0xabc', c.secret, 'attempt-2', now)).toBe(false);
  });

  it('a re-issued challenge invalidates the old one (new request kills old code)', async () => {
    const now = new Date('2026-10-25T14:00:00Z');
    const first = await issueChallenge(db, 'email_code', 'a@b.c', 600_000, now);
    const second = await issueChallenge(db, 'email_code', 'a@b.c', 600_000, new Date(now.getTime() + 1000));
    expect(first.secret).not.toBe(second.secret);
    expect(await claimChallenge(db, 'email_code', 'a@b.c', first.secret, 'attempt-1', now)).toBe(false);
    expect(await claimChallenge(db, 'email_code', 'a@b.c', second.secret, 'attempt-2', now)).toBe(true);
    expect(await claimChallenge(db, 'email_code', 'a@b.c', second.secret, 'attempt-3', now)).toBe(false);
  });

  it('attempt id is required', async () => {
    const now = new Date();
    const c = await issueChallenge(db, 'email_code', 'a@b.c', 600_000, now);
    await expect(claimChallenge(db, 'email_code', 'a@b.c', c.secret, '', now)).rejects.toThrow('attempt_id_required');
  });
});
