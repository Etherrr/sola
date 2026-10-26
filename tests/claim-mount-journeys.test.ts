/**
 * Authenticated LOCAL journeys through the ACTUAL mount wrappers
 * (functions/api/v1/claim/*) with the deps seam injected: genuine RS256 Access
 * assertions fully validated by the unchanged checkAccessJwt against a local JWKS
 * (no network, no production key fetch, no weakening of auth), real migrations
 * 0001-0004 on the sqlite adapter, real sessions. Harness mirrors
 * tests/claim-routes.test.ts; the difference is every request enters through the
 * production mount files, not the handlers directly.
 * Adapter-level only: not D1 evidence, not a deployment approval.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { onRequest as previewMount } from '../functions/api/v1/claim/preview';
import { onRequest as attemptMount } from '../functions/api/v1/claim/attempt';
import { onRequest as reportMount } from '../functions/api/v1/claim/report/[attemptId]';
import { onRequest as rollbackMount } from '../functions/api/v1/claim/rollback/[attemptId]';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import { ownerKey } from '../server/accounts/store';
import { LEGACY_VISIBILITY_GUARD_SQL } from '../server/claim/claim';
import type { ClaimDeps, ClaimEnv } from '../server/claim/routes';

const TEAM = 'team-example.cloudflareaccess.com';
const AUD = 'aud123';
const NOW = new Date('2026-10-26T07:00:00Z');
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function signer() {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as { n: string; e: string };
  const sign = async (payload: Record<string, unknown>) => {
    const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const body = enc(payload);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
  };
  return { sign, keys: [{ kid: 'k1', kty: 'RSA', n: jwk.n, e: jwk.e }] };
}

const SUB = 'legacy-sub-1';
const ISS = `https://${TEAM}`;
const K = ownerKey(ISS, SUB)!;

let raw: ReturnType<typeof createSqliteD1>['raw'];
let env: ClaimEnv;
let deps: ClaimDeps;
let cookieU1: string;
let cookieU2: string;
let jwt: string;

const req = (
  method: string,
  path: string,
  cookie?: string,
  assertion?: string | null,
  origin: string | null = 'https://preview.test',
) =>
  new Request(`https://preview.test${path}`, {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
      ...(assertion ? { 'cf-access-jwt-assertion': assertion } : {}),
    },
  });

const makeUser = async (db: ClaimEnv['PORTFOLIO_ACCOUNTS_DB'], userId: string, email: string) => {
  const now = NOW.toISOString();
  await db!.prepare('INSERT INTO users (id, status, created_at, updated_at) VALUES (?,?,?,?)').bind(userId, 'active', now, now).run();
  await db!.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES (?,?,'email',?,?)")
    .bind(crypto.randomUUID(), userId, email, now).run();
  await db!.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES (?,?,'test',?)")
    .bind(crypto.randomUUID(), email, now).run();
};

const seedLegacy = (rows: [string, string, string, string, string][]) => {
  for (const [net, addr, label, ca, ua] of rows)
    raw.prepare('INSERT INTO tracked_addresses VALUES (?,?,?,?,?,?)').run(K, net, addr, label, ca, ua);
};
const LEG: [string, string, string, string, string][] = [
  ['ethereum', '0xaaa', 'Ledger', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'],
  ['ethereum', '0xbbb', 'CEX', '2026-01-02T00:00:00Z', '2026-02-02T00:00:00Z'],
  ['solana', 'SoL111', 'Hot', '2026-01-03T00:00:00Z', '2026-02-03T00:00:00Z'],
];

beforeEach(async () => {
  const h = createSqliteD1();
  raw = h.raw;
  raw.exec(readFileSync(resolve(__dirname, '../migrations/0004_claims.sql'), 'utf8'));
  const s = await signer();
  jwt = await s.sign({
    iss: ISS, sub: SUB, aud: AUD,
    iat: Math.floor(NOW.getTime() / 1000) - 60,
    exp: Math.floor(NOW.getTime() / 1000) + 300,
  });
  env = {
    NATIVE_AUTH_ENABLED: 'true', CLAIM_ENABLED: '1',
    PORTFOLIO_ACCOUNTS_DB: h.db as never,
    ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD,
  };
  deps = { fetchKeys: async () => s.keys as never, now: () => NOW, id: () => 'req-j1' };
  await makeUser(env.PORTFOLIO_ACCOUNTS_DB, 'u1', 'u1@x.test');
  await makeUser(env.PORTFOLIO_ACCOUNTS_DB, 'u2', 'u2@x.test');
  raw.prepare("INSERT INTO portfolios (id, user_id, created_at) VALUES ('P-u1','u1',?)").run(NOW.toISOString());
  cookieU1 = `${SESSION_COOKIE}=${(await createSession(h.db, 'u1')).id}`;
  cookieU2 = `${SESSION_COOKIE}=${(await createSession(h.db, 'u2')).id}`;
});

describe('full journey through the actual mounts (genuine RS256, local JWKS)', () => {
  it('preview -> attempt -> report -> rollback, all through mount wrappers', async () => {
    seedLegacy(LEG);
    // 1. Preview: advisory enumeration, not yet claimed.
    const pv = await previewMount({ request: req('GET', '/api/v1/claim/preview', cookieU1, jwt), env }, deps);
    expect(pv.status).toBe(200);
    const pvb = (await pv.json()) as { advisory: boolean; alreadyClaimed: boolean; toCopy: unknown[] };
    expect(pvb.advisory).toBe(true);
    expect(pvb.alreadyClaimed).toBe(false);
    expect(pvb.toCopy).toHaveLength(3);

    // 2. Attempt: authoritative report, ledger owned by the session user.
    const at = await attemptMount({ request: req('POST', '/api/v1/claim/attempt', cookieU1, jwt), env }, deps);
    expect(at.status).toBe(200);
    const atb = (await at.json()) as { attemptId: string; report: { disposition: string }[] };
    expect(atb.report).toHaveLength(3);
    expect(atb.report.every((x) => x.disposition === 'copied')).toBe(true);
    const led = raw.prepare('SELECT user_id, state FROM claims_ledger WHERE id = ?').get(atb.attemptId) as { user_id: string; state: string };
    expect(led).toEqual({ user_id: 'u1', state: 'claimed' });

    // 3. Report through the dynamic mount: the path param reaches the handler.
    const rp = await reportMount(
      { request: req('GET', `/api/v1/claim/report/${atb.attemptId}`, cookieU1), env, params: { attemptId: atb.attemptId } },
      deps,
    );
    expect(rp.status).toBe(200);
    const rpb = (await rp.json()) as { attemptId: string; state: string; report: unknown[] };
    expect(rpb.attemptId).toBe(atb.attemptId);
    expect(rpb.state).toBe('claimed');
    expect(rpb.report).toHaveLength(3);

    // 4. Rollback: 200, pre-claim world restored, legacy rows re-exposed.
    const rb = await rollbackMount(
      { request: req('POST', `/api/v1/claim/rollback/${atb.attemptId}`, cookieU1, null), env, params: { attemptId: atb.attemptId } },
      deps,
    );
    expect(rb.status).toBe(200);
    expect(((await rb.json()) as { state: string }).state).toBe('rolled_back');
    expect((raw.prepare('SELECT COUNT(*) c FROM portfolio_addresses').get() as { c: number }).c).toBe(0);
    const vis = (raw.prepare(`SELECT COUNT(*) c FROM tracked_addresses WHERE owner_issuer_subject = ? ${LEGACY_VISIBILITY_GUARD_SQL}`).get(K) as { c: number }).c;
    expect(vis).toBe(3);
  });

  it('negative isolation: a foreign session gets 404 unknown_attempt at BOTH dynamic mounts', async () => {
    seedLegacy(LEG);
    const at = await attemptMount({ request: req('POST', '/api/v1/claim/attempt', cookieU1, jwt), env }, deps);
    const { attemptId } = (await at.json()) as { attemptId: string };
    const foreignReport = await reportMount(
      { request: req('GET', `/api/v1/claim/report/${attemptId}`, cookieU2), env, params: { attemptId } },
      deps,
    );
    expect(foreignReport.status).toBe(404);
    expect(((await foreignReport.json()) as { error: { code: string } }).error.code).toBe('unknown_attempt');
    const foreignRollback = await rollbackMount(
      { request: req('POST', `/api/v1/claim/rollback/${attemptId}`, cookieU2, null), env, params: { attemptId } },
      deps,
    );
    expect(foreignRollback.status).toBe(404);
  });

  it('negative auth and origin: 401 without assertion, 403 cross-origin, replay 409 already_claimed', async () => {
    seedLegacy(LEG);
    const noJwt = await attemptMount({ request: req('POST', '/api/v1/claim/attempt', cookieU1, null), env }, deps);
    expect(noJwt.status).toBe(401);
    const crossOrigin = await attemptMount(
      { request: req('POST', '/api/v1/claim/attempt', cookieU1, jwt, 'https://evil.example'), env },
      deps,
    );
    expect(crossOrigin.status).toBe(403);
    await attemptMount({ request: req('POST', '/api/v1/claim/attempt', cookieU1, jwt), env }, deps);
    const replay = await attemptMount({ request: req('POST', '/api/v1/claim/attempt', cookieU1, jwt), env }, deps);
    expect(replay.status).toBe(409);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe('already_claimed');
  });

  it('flag absent through the mount: authed request still gets 503 disabled, DB untouched', async () => {
    const envOff = { ...env, CLAIM_ENABLED: '0' } as ClaimEnv;
    const res = await attemptMount({ request: req('POST', '/api/v1/claim/attempt', cookieU1, jwt), env: envOff }, deps);
    expect(res.status).toBe(503);
    expect((raw.prepare('SELECT COUNT(*) c FROM claims_ledger').get() as { c: number }).c).toBe(0);
  });
});
