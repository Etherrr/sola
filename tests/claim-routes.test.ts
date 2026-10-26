/**
 * Synthetic endpoint tests for the UNREACHABLE claim route draft (server/claim/routes.ts).
 * All-local: sqlite D1 fake executing the real migrations (0001-0004), synthetic RS256
 * Access assertions, injected fetchKeys. No network, no provider/auth calls.
 * Adapter-level only: not D1 evidence, not a wiring approval.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  handleClaimPreview,
  handleClaimAttempt,
  handleClaimReport,
  handleClaimRollback,
  type ClaimEnv,
  type ClaimDeps,
} from '../server/claim/routes';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import { ownerKey } from '../server/accounts/store';
import { LEGACY_VISIBILITY_GUARD_SQL } from '../server/claim/claim';

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
  const sign = async (payload: Record<string, unknown>, kid = 'k1') => {
    const head = enc({ alg: 'RS256', kid, typ: 'JWT' });
    const body = enc(payload);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
  };
  return { sign, keys: [{ kid: 'k1', kty: 'RSA', n: jwk.n, e: jwk.e }] };
}

const SUB = 'legacy-sub-1';
const ISS = `https://${TEAM}`;
const K = ownerKey(ISS, SUB)!;
const jwtPayload = (over: Record<string, unknown> = {}) => ({
  iss: ISS, sub: SUB, aud: AUD,
  iat: Math.floor(NOW.getTime() / 1000) - 60,
  exp: Math.floor(NOW.getTime() / 1000) + 300,
  ...over,
});

let raw: ReturnType<typeof createSqliteD1>['raw'];
let env: ClaimEnv;
let deps: ClaimDeps;
let cookieU1: string;
let cookieU2: string;
let jwt: string;

const req = (method: string, path: string, cookie?: string, assertion?: string | null, origin: string | null = 'https://preview.test') =>
  new Request(`https://preview.test${path}`, {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
      ...(assertion ? { 'cf-access-jwt-assertion': assertion } : {}),
    },
  });

const makeUser = async (db: typeof env.PORTFOLIO_ACCOUNTS_DB, userId: string, email: string) => {
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
const seedNative = (rows: [string, string, string, string, string, string | null][]) => {
  for (const [net, addr, label, ver, ca, ra] of rows)
    raw.prepare('INSERT INTO portfolio_addresses VALUES (?,?,?,?,?,?,?)').run('P-u1', net, addr, label, ver, ca, ra);
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
  jwt = await s.sign(jwtPayload());
  env = {
    NATIVE_AUTH_ENABLED: 'true', CLAIM_ENABLED: '1',
    PORTFOLIO_ACCOUNTS_DB: h.db as never,
    ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD,
  };
  deps = { fetchKeys: async () => s.keys as never, now: () => NOW, id: () => 'req-1' };
  await makeUser(env.PORTFOLIO_ACCOUNTS_DB, 'u1', 'u1@x.test');
  await makeUser(env.PORTFOLIO_ACCOUNTS_DB, 'u2', 'u2@x.test');
  raw.prepare("INSERT INTO portfolios (id, user_id, created_at) VALUES ('P-u1','u1',?)").run(NOW.toISOString());
  const s1 = await createSession(h.db, 'u1');
  const s2 = await createSession(h.db, 'u2');
  cookieU1 = `${SESSION_COOKIE}=${s1.id}`;
  cookieU2 = `${SESSION_COOKIE}=${s2.id}`;
});

describe('gates', () => {
  it('503 disabled when CLAIM_ENABLED absent', async () => {
    seedLegacy(LEG);
    const e = { ...env, CLAIM_ENABLED: undefined };
    const r = await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), e, deps);
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('disabled');
  });
  it('503 not_configured on malformed team host', async () => {
    seedLegacy(LEG);
    const e = { ...env, ACCESS_TEAM_DOMAIN: `https://${TEAM}` };
    const r = await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), e, deps);
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('not_configured');
  });
  it('401 without session; 401 without assertion; 403 without origin', async () => {
    seedLegacy(LEG);
    expect((await handleClaimAttempt(req('POST', '/api/v1/claim', undefined, jwt), env, deps)).status).toBe(401);
    const noJwt = await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, null), env, deps);
    expect(noJwt.status).toBe(401);
    expect((await noJwt.json()).error.code).toBe('assertion_invalid');
    expect((await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt, null), env, deps)).status).toBe(403);
  });
});

describe('preview (advisory)', () => {
  it('enumerates the three sets with merged counts, labeled advisory', async () => {
    seedLegacy(LEG);
    seedNative([['ethereum', '0xaaa', 'MINE', 'verified', '2026-03-01T00:00:00Z', null],
               ['solana', 'SoL111', 'OLD', 'watched', '2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z']]);
    const r = await handleClaimPreview(req('GET', '/api/v1/claim/preview', cookieU1, jwt), env, deps);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.advisory).toBe(true);
    expect(b.alreadyClaimed).toBe(false);
    expect(b.toCopy.map((x: { address: string }) => x.address)).toEqual(['0xbbb']);
    expect(b.liveDuplicates.map((x: { address: string }) => x.address)).toEqual(['0xaaa']);
    expect(b.tombstoneDuplicates.map((x: { address: string }) => x.address)).toEqual(['SoL111']);
    expect(b.mergedCount.ethereum).toBe(2); // 1 native live + 2 legacy - 1 dup
    expect(b.mergedCount.solana).toBe(0);   // 0 live + 1 legacy - 1 tombstone dup
  });
  it('R3: activeAttemptId disclosed ONLY to the owning session; foreign owner-K holder gets null', async () => {
    seedLegacy(LEG);
    // Before any claim: no disclosure, not claimed.
    const before = await (await handleClaimPreview(req('GET', '/api/v1/claim/preview', cookieU1, jwt), env, deps)).json();
    expect(before.alreadyClaimed).toBe(false);
    expect(before.activeAttemptId).toBeNull();
    // u1 claims.
    const a = await (await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps)).json();
    // Owning session recovers the attempt id.
    const mine = await (await handleClaimPreview(req('GET', '/api/v1/claim/preview', cookieU1, jwt), env, deps)).json();
    expect(mine.alreadyClaimed).toBe(true);
    expect(mine.activeAttemptId).toBe(a.attemptId);
    // Another session user holding a valid K assertion: claimed is visible, but
    // NO attempt id, hence no report and no undo path (B5/existence protection).
    const other = await (await handleClaimPreview(req('GET', '/api/v1/claim/preview', cookieU2, jwt), env, deps)).json();
    expect(other.alreadyClaimed).toBe(true);
    expect(other.activeAttemptId).toBeNull();
  });
  it('R3: after rollback there is no active claim - alreadyClaimed false, activeAttemptId null', async () => {
    seedLegacy(LEG);
    const a = await (await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps)).json();
    await handleClaimRollback(req('POST', '/x', cookieU1, null), env, deps, a.attemptId);
    const b = await (await handleClaimPreview(req('GET', '/api/v1/claim/preview', cookieU1, jwt), env, deps)).json();
    expect(b.alreadyClaimed).toBe(false);
    expect(b.activeAttemptId).toBeNull();
  });
  it('is read-only: no portfolio exists for u2, preview creates none', async () => {
    seedLegacy(LEG);
    expect((raw.prepare("SELECT COUNT(*) c FROM portfolios WHERE user_id='u2'").get() as { c: number }).c).toBe(0);
    const r = await handleClaimPreview(req('GET', '/api/v1/claim/preview', cookieU2, jwt), env, deps);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.toCopy).toHaveLength(3); // no portfolio -> every legacy row would copy
    expect(b.mergedCount.ethereum).toBe(2);
    expect((raw.prepare("SELECT COUNT(*) c FROM portfolios WHERE user_id='u2'").get() as { c: number }).c).toBe(0);
  });
});

describe('attempt', () => {
  it('happy path: 200 with authoritative S3-derived report; ledger owned by session user', async () => {
    seedLegacy(LEG);
    const r = await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.report).toHaveLength(3);
    expect(b.report.every((x: { disposition: string }) => x.disposition === 'copied')).toBe(true);
    const led = raw.prepare('SELECT user_id, state FROM claims_ledger WHERE id = ?').get(b.attemptId) as { user_id: string; state: string };
    expect(led).toEqual({ user_id: 'u1', state: 'claimed' });
    expect((raw.prepare('SELECT COUNT(*) c FROM portfolio_addresses').get() as { c: number }).c).toBe(3);
  });
  it('replay: 409 already_claimed, zero partial state', async () => {
    seedLegacy(LEG);
    await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps);
    const r2 = await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps);
    expect(r2.status).toBe(409);
    expect((await r2.json()).error.code).toBe('already_claimed');
    expect((raw.prepare('SELECT COUNT(*) c FROM claims_ledger').get() as { c: number }).c).toBe(1);
    expect((raw.prepare('SELECT COUNT(*) c FROM claim_before_images').get() as { c: number }).c).toBe(3);
  });
  it('cap exceeded: 409 cap_exceeded with advisory merged counts, nothing mutated', async () => {
    seedLegacy(LEG);
    seedNative([['ethereum', '0xn1', 'a', 'watched', '2026-01-01T00:00:00Z', null],
               ['ethereum', '0xn2', 'b', 'watched', '2026-01-01T00:00:00Z', null],
               ['ethereum', '0xn3', 'c', 'watched', '2026-01-01T00:00:00Z', null],
               ['ethereum', '0xn4', 'd', 'watched', '2026-01-01T00:00:00Z', null]]);
    const r = await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps);
    expect(r.status).toBe(409);
    const b = await r.json();
    expect(b.error.code).toBe('cap_exceeded');
    expect(b.mergedCount.ethereum).toBe(6); // 4 native live + 2 legacy - 0 dups > 5
    expect(b.mergedCount.solana).toBe(1);
    expect((raw.prepare('SELECT COUNT(*) c FROM claims_ledger').get() as { c: number }).c).toBe(0);
    expect((raw.prepare('SELECT COUNT(*) c FROM portfolio_addresses').get() as { c: number }).c).toBe(4);
  });
  it('no legacy rows: 409 no_legacy_rows', async () => {
    const r = await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps);
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('no_legacy_rows');
  });
});

describe('error honesty (reviewer R2)', () => {
  it('batch failure with NO active claim: 500 claim_failed, never a false 409', async () => {
    seedLegacy(LEG);
    raw.exec('DROP TABLE claims_ledger_rows'); // force the batch to fail mid-way
    const r = await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps);
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe('claim_failed');
    expect((raw.prepare('SELECT COUNT(*) c FROM claims_ledger').get() as { c: number }).c).toBe(0); // batch rolled back
  });
  it('batch failure WITH a confirmed active claim: 409 already_claimed', async () => {
    seedLegacy(LEG);
    raw.prepare("INSERT INTO claims_ledger VALUES ('prior',?,'u1','claimed',?,NULL)").run(K, NOW.toISOString());
    raw.exec('DROP TABLE claims_ledger_rows');
    const r = await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps);
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('already_claimed');
  });
  it('catch-path confirmation read ALSO failing: honest 500, never a throw or false 409', async () => {
    seedLegacy(LEG);
    raw.exec('DROP TABLE claims_ledger'); // batch fails AND the confirmation read fails
    const r = await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps);
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe('claim_failed');
  });
  it('rollback batch failure: honest 500, state untouched', async () => {
    seedLegacy(LEG);
    const a = await (await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps)).json();
    raw.exec('DROP TABLE claim_before_images'); // break R1's before-image EXISTS
    const r = await handleClaimRollback(req('POST', '/x', cookieU1, null), env, deps, a.attemptId);
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe('rollback_failed');
    expect((raw.prepare('SELECT state FROM claims_ledger').get() as { state: string }).state).toBe('claimed');
  });
});

describe('report + rollback scoping (B5)', () => {
  it('report is session-scoped; foreign attempt id is 404 unknown_attempt', async () => {
    seedLegacy(LEG);
    const a = await (await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps)).json();
    const own = await handleClaimReport(req('GET', '/x', cookieU1), env, deps, a.attemptId);
    expect(own.status).toBe(200);
    expect(((await own.json()).report)).toHaveLength(3);
    const foreign = await handleClaimReport(req('GET', '/x', cookieU2), env, deps, a.attemptId);
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error.code).toBe('unknown_attempt');
    const rbForeign = await handleClaimRollback(req('POST', '/x', cookieU2, null), env, deps, a.attemptId);
    expect(rbForeign.status).toBe(404);
  });
});

describe('rollback', () => {
  it('clean rollback restores pre-claim world and re-exposes legacy rows', async () => {
    seedLegacy(LEG);
    seedNative([['solana', 'SoLpre', 'PRE', 'verified', '2026-01-01T00:00:00Z', null]]);
    const a = await (await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps)).json();
    const r = await handleClaimRollback(req('POST', '/x', cookieU1, null), env, deps, a.attemptId);
    expect(r.status).toBe(200);
    expect((await r.json()).state).toBe('rolled_back');
    expect((raw.prepare('SELECT COUNT(*) c FROM portfolio_addresses').get() as { c: number }).c).toBe(1);
    const vis = (raw.prepare(`SELECT COUNT(*) c FROM tracked_addresses WHERE owner_issuer_subject = ? ${LEGACY_VISIBILITY_GUARD_SQL}`).get(K) as { c: number }).c;
    expect(vis).toBe(3);
    const again = await handleClaimRollback(req('POST', '/x', cookieU1, null), env, deps, a.attemptId);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('already_rolled_back');
  });
  it('offender blocks rollback with named rows + remedy; reconcile then retry succeeds', async () => {
    seedLegacy(LEG);
    const a = await (await handleClaimAttempt(req('POST', '/api/v1/claim', cookieU1, jwt), env, deps)).json();
    raw.prepare("UPDATE portfolio_addresses SET label='RENAMED' WHERE address='0xbbb'").run();
    const r = await handleClaimRollback(req('POST', '/x', cookieU1, null), env, deps, a.attemptId);
    expect(r.status).toBe(409);
    const b = await r.json();
    expect(b.error.code).toBe('rollback_blocked');
    expect(b.offenders).toEqual([{ network: 'ethereum', address: '0xbbb' }]);
    expect(b.remedy).toContain('reconcile_or_remove');
    expect((raw.prepare("SELECT state FROM claims_ledger").get() as { state: string }).state).toBe('claimed');
    raw.prepare("UPDATE portfolio_addresses SET removed_at='2026-10-26T07:05:00Z' WHERE address='0xbbb'").run();
    const r2 = await handleClaimRollback(req('POST', '/x', cookieU1, null), env, deps, a.attemptId);
    expect(r2.status).toBe(200);
    expect((raw.prepare("SELECT removed_at FROM portfolio_addresses WHERE address='0xbbb'").get() as { removed_at: string | null }).removed_at).toBe('2026-10-26T07:05:00Z');
  });
});
