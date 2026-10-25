import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';
import type { ChallengeDb } from '../server/auth/challenges';
import { createSession, readLiveSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import {
  handleNativeSessionInfo,
  handleNativeLogout,
} from '../server/auth/session-info';

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

const ON = { NATIVE_AUTH_ENABLED: 'true' };
const URL_ = 'https://preview.sola-lens.pages.dev/api/v1/auth/email/session';
const req = (cookie?: string, method = 'GET', origin?: string) =>
  new Request(URL_, {
    method,
    headers: {
      ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}),
      ...(origin ? { origin } : {}),
    },
  });

describe('native session info', () => {
  let db: ChallengeDb;
  const now = new Date('2026-10-25T14:00:00Z');
  beforeEach(async () => {
    db = makeDb();
    await db
      .prepare(`INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)`)
      .bind(now.toISOString(), now.toISOString())
      .run();
    await db
      .prepare(
        `INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at)
         VALUES ('i1','u1','email','junjcchen204@gmail.com',?)`,
      )
      .bind(now.toISOString())
      .run();
  });

  it('fails closed when the feature is off or unbound', async () => {
    expect((await handleNativeSessionInfo(req('x'), {})).status).toBe(503);
    expect((await handleNativeSessionInfo(req('x'), { NATIVE_AUTH_ENABLED: 'true' })).status).toBe(503);
  });

  it('rejects non-GET', async () => {
    const res = await handleNativeSessionInfo(req(undefined, 'POST', URL_), {
      ...ON,
      PORTFOLIO_ACCOUNTS_DB: db,
    });
    expect(res.status).toBe(405);
  });

  it('401 without a cookie and with a dead session', async () => {
    const env = { ...ON, PORTFOLIO_ACCOUNTS_DB: db };
    expect((await handleNativeSessionInfo(req(), env)).status).toBe(401);
    expect((await handleNativeSessionInfo(req('nope'), env)).status).toBe(401);
  });

  it('returns the verified email; freshness reflects the real re-auth window', async () => {
    // Old session (fixture clock hours behind real time): outside the window.
    const old = await createSession(db, 'u1', now);
    const resOld = await handleNativeSessionInfo(req(old.id), { ...ON, PORTFOLIO_ACCOUNTS_DB: db });
    expect(resOld.status).toBe(200);
    expect(await resOld.json()).toEqual({
      status: 'ok', email: 'junjcchen204@gmail.com', fresh: false,
    });
    expect(resOld.headers.get('cache-control')).toBe('no-store');
    // Real-time session: inside the window.
    const live = await createSession(db, 'u1');
    const resLive = await handleNativeSessionInfo(req(live.id), { ...ON, PORTFOLIO_ACCOUNTS_DB: db });
    expect((await resLive.json()).fresh).toBe(true);
  });

  it('401 when the session user has no verified email identity - never a guess', async () => {
    await db.prepare(`DELETE FROM auth_identities`).bind().run();
    const s = await createSession(db, 'u1', now);
    const res = await handleNativeSessionInfo(req(s.id), { ...ON, PORTFOLIO_ACCOUNTS_DB: db });
    expect(res.status).toBe(401);
  });
});

describe('native logout', () => {
  let db: ChallengeDb;
  const now = new Date('2026-10-25T14:00:00Z');
  const env = () => ({ NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db });
  beforeEach(async () => {
    db = makeDb();
    await db
      .prepare(`INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)`)
      .bind(now.toISOString(), now.toISOString())
      .run();
  });

  it('revokes exactly the cookie-named session and clears the cookie', async () => {
    const s = await createSession(db, 'u1', now);
    const res = await handleNativeLogout(
      req(s.id, 'POST', 'https://preview.sola-lens.pages.dev'),
      env(),
    );
    expect(res.status).toBe(200);
    expect(await readLiveSession(db, s.id, now)).toBeNull();
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('is same-origin only', async () => {
    const s = await createSession(db, 'u1', now);
    const res = await handleNativeLogout(req(s.id, 'POST', 'https://evil.example'), env());
    expect(res.status).toBe(403);
    expect((await readLiveSession(db, s.id, now))?.id).toBe(s.id);
  });

  it('revokes only the named session - a second live session survives', async () => {
    const first = await createSession(db, 'u1', now);
    const second = await createSession(db, 'u1', now);
    const res = await handleNativeLogout(
      req(first.id, 'POST', 'https://preview.sola-lens.pages.dev'),
      env(),
    );
    expect(res.status).toBe(200);
    expect(await readLiveSession(db, first.id, now)).toBeNull();
    expect((await readLiveSession(db, second.id, now))?.id).toBe(second.id);
  });

  it('is idempotent for a dead session - still clears the cookie', async () => {
    const res = await handleNativeLogout(
      req('gone', 'POST', 'https://preview.sola-lens.pages.dev'),
      env(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('fails closed when the feature is off', async () => {
    const res = await handleNativeLogout(req('x', 'POST', 'https://preview.sola-lens.pages.dev'), {});
    expect(res.status).toBe(503);
  });
});
