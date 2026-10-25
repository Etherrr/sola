import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { handleSnapshotConsentStatus, handleSnapshotConsentChange } from '../server/portfolio/consent';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE, type NativeAuthEnv } from '../server/auth/email';

let db: ReturnType<typeof createSqliteD1>['db'];
let env: NativeAuthEnv;
let cookie: string;

const post = (body: unknown, c?: string) =>
  new Request('https://preview.test/api/v1/portfolio/snapshots/consent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://preview.test',
      ...(c ? { cookie: c } : {}),
    },
    body: JSON.stringify(body),
  });
const get = (c?: string) =>
  new Request('https://preview.test/api/v1/portfolio/snapshots/consent', {
    method: 'GET',
    headers: { cookie: c ?? '' },
  });

const entitle = async (userId: string, email: string) => {
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES (?, ?, 'email', ?, ?)")
    .bind(crypto.randomUUID(), userId, email, now).run();
  await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES (?, ?, 'test', ?)")
    .bind(crypto.randomUUID(), email, now).run();
};

beforeEach(async () => {
  ({ db } = createSqliteD1());
  env = { NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db };
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(now, now).run();
  await entitle('u1', 'u1@x.test');
  const s = await createSession(db, 'u1');
  cookie = `${SESSION_COOKIE}=${s.id}`;
});

describe('snapshot consent routes', () => {
  it('starts OFF (default), grants on explicit action, status reflects it', async () => {
    const s0 = await handleSnapshotConsentStatus(get(cookie), env);
    expect(s0.status).toBe(200);
    expect(((await s0.json()) as { consented: boolean }).consented).toBe(false);
    const g = await handleSnapshotConsentChange(post({ action: 'grant' }, cookie), env);
    expect(g.status).toBe(200);
    const s1 = await handleSnapshotConsentStatus(get(cookie), env);
    expect(((await s1.json()) as { consented: boolean }).consented).toBe(true);
  });

  it('withdraw revokes and reports deletions; status flips off', async () => {
    await handleSnapshotConsentChange(post({ action: 'grant' }, cookie), env);
    const w = await handleSnapshotConsentChange(post({ action: 'withdraw' }, cookie), env);
    expect(w.status).toBe(200);
    const body = (await w.json()) as { consented: boolean; deleted: { balances: number; positions: number; prices: number } };
    expect(body.consented).toBe(false);
    expect(body.deleted).toEqual({ balances: 0, positions: 0, prices: 0 });
    const s = await handleSnapshotConsentStatus(get(cookie), env);
    expect(((await s.json()) as { consented: boolean }).consented).toBe(false);
  });

  it('requires an entitled session: no cookie 401, cross-origin POST refused', async () => {
    expect((await handleSnapshotConsentStatus(get(), env)).status).toBe(401);
    expect((await handleSnapshotConsentChange(post({ action: 'grant' }), env)).status).toBe(401);
    const foreign = new Request('https://preview.test/api/v1/portfolio/snapshots/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.test', cookie },
      body: JSON.stringify({ action: 'grant' }),
    });
    expect((await handleSnapshotConsentChange(foreign, env)).status).toBe(403);
    const s = await handleSnapshotConsentStatus(get(cookie), env);
    expect(((await s.json()) as { consented: boolean }).consented).toBe(false);
  });

  it('rejects unknown actions with 400 and no state change', async () => {
    const r = await handleSnapshotConsentChange(post({ action: 'everything' }, cookie), env);
    expect(r.status).toBe(400);
    const s = await handleSnapshotConsentStatus(get(cookie), env);
    expect(((await s.json()) as { consented: boolean }).consented).toBe(false);
  });

  it('disabled flag answers 503', async () => {
    const off: NativeAuthEnv = { NATIVE_AUTH_ENABLED: 'false', PORTFOLIO_ACCOUNTS_DB: db };
    expect((await handleSnapshotConsentStatus(get(cookie), off)).status).toBe(503);
    expect((await handleSnapshotConsentChange(post({ action: 'grant' }, cookie), off)).status).toBe(503);
  });
});
