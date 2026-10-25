import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';
import type { ChallengeDb } from '../server/auth/challenges';
import {
  createSession,
  readLiveSession,
  recentlyAuthenticated,
  revokeAllSessions,
  revokeSession,
  rotateSession,
} from '../server/auth/sessions';

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
            async first<T>() {
              return (stmt.get(...(args as never[])) ?? null) as T | null;
            },
          };
        },
      };
    },
  };
}

describe('native sessions', () => {
  let db: ChallengeDb;
  const now = new Date('2026-10-25T14:00:00Z');
  beforeEach(async () => {
    db = makeDb();
    await db.prepare(`INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)`).bind(now.toISOString(), now.toISOString()).run();
  });

  it('creates and reads a live session; unknown id reads null', async () => {
    const s = await createSession(db, 'u1', now);
    expect((await readLiveSession(db, s.id, now))?.user_id).toBe('u1');
    expect(await readLiveSession(db, 'nope', now)).toBeNull();
  });

  it('expired sessions read null', async () => {
    const s = await createSession(db, 'u1', now);
    const later = new Date(now.getTime() + 15 * 24 * 3600 * 1000);
    expect(await readLiveSession(db, s.id, later)).toBeNull();
  });

  it('rotation revokes the old id and links the new one', async () => {
    const s = await createSession(db, 'u1', now);
    const fresh = await rotateSession(db, s.id, now);
    expect(fresh).not.toBeNull();
    expect(fresh!.rotated_from).toBe(s.id);
    expect(await readLiveSession(db, s.id, now)).toBeNull();
    expect((await readLiveSession(db, fresh!.id, now))?.user_id).toBe('u1');
    // rotating a dead id fails closed
    expect(await rotateSession(db, s.id, now)).toBeNull();
  });

  it('revokeSession kills one; revokeAllSessions kills all for the user', async () => {
    const a = await createSession(db, 'u1', now);
    const b = await createSession(db, 'u1', now);
    await revokeSession(db, a.id, now);
    expect(await readLiveSession(db, a.id, now)).toBeNull();
    expect(await readLiveSession(db, b.id, now)).not.toBeNull();
    expect(await revokeAllSessions(db, 'u1', now)).toBe(1);
    expect(await readLiveSession(db, b.id, now)).toBeNull();
  });

  it('recentlyAuthenticated enforces the 10-minute sensitive window', async () => {
    const s = await createSession(db, 'u1', now);
    expect(recentlyAuthenticated(s, new Date(now.getTime() + 5 * 60_000))).toBe(true);
    expect(recentlyAuthenticated(s, new Date(now.getTime() + 11 * 60_000))).toBe(false);
  });
});
