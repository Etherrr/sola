/**
 * Dual-gate matrix: shared-data handlers (portfolio resolve/health/networks,
 * markets overview)
 * admit EITHER a verified Cloudflare Access JWT OR a live ENTITLED native
 * session; owner-keyed legacy handlers (accounts, portfolio/session) stay
 * Access-JWT-only. All-local: synthetic RS256 assertions, sqlite D1 fake
 * running the real migrations. No network, no provider calls.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import {
  handleResolve,
  handleHealth,
  handleNetworks,
  handleSession,
  defaultDeps,
  type Deps,
  type Env,
} from '../server/portfolio/handler';
import {
  handleOverview as handleMarkets,
  type Deps as MarketsDeps,
  type Env as MarketsEnv,
} from '../server/markets/handler';
import { createOverviewCache, type OverviewDeps } from '../server/markets/overview';
import { INSTRUMENTS } from '../server/markets/instruments';
import { dualLimiterKey, type DualIdentity } from '../server/auth/dual-gate';

const TEAM = 'team-example.cloudflareaccess.com';
const AUD = 'aud123';
const NOW = new Date('2026-10-26T07:00:00Z');
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function signer() {
  const kp = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as { n: string; e: string };
  const sign = async (payload: Record<string, unknown>) => {
    const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const body = enc(payload);
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      kp.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    );
    return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
  };
  return { sign, keys: [{ kid: 'k1', kty: 'RSA', n: jwk.n, e: jwk.e }] };
}

const good = (over: Record<string, unknown> = {}) => ({
  iss: `https://${TEAM}`,
  aud: [AUD],
  exp: Math.floor(NOW.getTime() / 1000) + 600,
  sub: 'legacy-sub-1',
  ...over,
});

type H = ReturnType<typeof createSqliteD1>;
let h: H;
let cookieEntitled: string;
let cookieUnentitled: string;
let cookieRevoked: string;

const makeUser = async (userId: string, email: string, entitled: boolean) => {
  const now = new Date().toISOString();
  await h.db
    .prepare('INSERT INTO users (id, status, created_at, updated_at) VALUES (?,?,?,?)')
    .bind(userId, 'active', now, now)
    .run();
  await h.db
    .prepare(
      "INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES (?,?,'email',?,?)",
    )
    .bind(crypto.randomUUID(), userId, email, now)
    .run();
  if (entitled)
    await h.db
      .prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES (?,?,'test',?)")
      .bind(crypto.randomUUID(), email, now)
      .run();
};

beforeEach(async () => {
  h = createSqliteD1();
  await makeUser('u1', 'u1@x.test', true);
  await makeUser('u2', 'u2@x.test', false);
  await makeUser('u3', 'u3@x.test', true);
  const s1 = await createSession(h.db, 'u1');
  const s2 = await createSession(h.db, 'u2');
  const s3 = await createSession(h.db, 'u3');
  cookieEntitled = `${SESSION_COOKIE}=${s1.id}`;
  cookieUnentitled = `${SESSION_COOKIE}=${s2.id}`;
  cookieRevoked = `${SESSION_COOKIE}=${s3.id}`;
  h.raw.exec(
    "UPDATE entitlements SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email = 'u3@x.test'",
  );
});

const ENV: Env = {
  PORTFOLIO_API_ENABLED: 'true',
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  NATIVE_AUTH_ENABLED: 'true',
  get PORTFOLIO_ACCOUNTS_DB() {
    return h.db as never;
  },
};
const deps = (keys: unknown[]): Deps => ({
  ...defaultDeps(),
  fetchKeys: async () => keys as never,
  now: () => NOW,
  id: () => 'req-1',
});

const A2 = '0x' + '1'.repeat(39) + '2';
const VALID_BODY = { network: 'ethereum', addresses: [A2], currency: 'USD' };

type Cred = { jwt?: string; cookie?: string };
const hdrs = (c: Cred, extra: Record<string, string> = {}) => ({
  ...(c.jwt ? { 'cf-access-jwt-assertion': c.jwt } : {}),
  ...(c.cookie ? { cookie: c.cookie } : {}),
  ...extra,
});
const postResolve = (c: Cred) =>
  new Request('https://app.example/api/v1/portfolio/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...hdrs(c) },
    body: JSON.stringify(VALID_BODY),
  });
const getP = (path: string, c: Cred) =>
  new Request(`https://app.example${path}`, { method: 'GET', headers: hdrs(c) });

describe('resolve: per-handler dual-gate matrix', () => {
  it('admits a valid Access JWT (no native session)', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    expect((await handleResolve(postResolve({ jwt }), ENV, deps(s.keys))).status).toBe(200);
  });
  it('admits a native ENTITLED session (no JWT)', async () => {
    const s = await signer();
    expect(
      (await handleResolve(postResolve({ cookie: cookieEntitled }), ENV, deps(s.keys))).status,
    ).toBe(200);
  });
  it('403s a native UNENTITLED session', async () => {
    const s = await signer();
    const r = await handleResolve(postResolve({ cookie: cookieUnentitled }), ENV, deps(s.keys));
    expect(r.status).toBe(403);
  });
  it('403s a REVOKED entitlement', async () => {
    const s = await signer();
    const r = await handleResolve(postResolve({ cookie: cookieRevoked }), ENV, deps(s.keys));
    expect(r.status).toBe(403);
  });
  it('401s anonymous', async () => {
    const s = await signer();
    expect((await handleResolve(postResolve({}), ENV, deps(s.keys))).status).toBe(401);
  });
  it('a present-but-bad JWT never falls through to a valid native session', async () => {
    const s = await signer();
    const other = await signer();
    const forged = await other.sign(good()); // right shape, wrong key
    const r = await handleResolve(
      postResolve({ jwt: forged, cookie: cookieEntitled }),
      ENV,
      deps(s.keys),
    );
    expect(r.status).toBe(401);
  });
  it('with the native path OFF a cookie alone preserves the old 401 contract', async () => {
    const s = await signer();
    const env: Env = { PORTFOLIO_API_ENABLED: 'true', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
    const r = await handleResolve(postResolve({ cookie: cookieEntitled }), env, deps(s.keys));
    expect(r.status).toBe(401);
    expect((await r.json()).error.code).toBe('unauthorized');
  });
});

describe('health + networks: dual-gate matrix', () => {
  it('admits native entitled; 401 anonymous; bad JWT never falls through', async () => {
    const s = await signer();
    const d = deps(s.keys);
    const other = await signer();
    const forged = await other.sign(good());
    expect(
      (await handleHealth(getP('/api/v1/health', { cookie: cookieEntitled }), ENV, d)).status,
    ).toBe(200);
    expect(
      (await handleNetworks(getP('/api/v1/networks', { cookie: cookieEntitled }), ENV, d)).status,
    ).toBe(200);
    expect((await handleHealth(getP('/api/v1/health', {}), ENV, d)).status).toBe(401);
    expect((await handleNetworks(getP('/api/v1/networks', {}), ENV, d)).status).toBe(401);
    expect(
      (await handleHealth(getP('/api/v1/health', { jwt: forged, cookie: cookieEntitled }), ENV, d))
        .status,
    ).toBe(401);
    expect(
      (
        await handleNetworks(
          getP('/api/v1/networks', { jwt: forged, cookie: cookieEntitled }),
          ENV,
          d,
        )
      ).status,
    ).toBe(401);
    expect(
      (await handleHealth(getP('/api/v1/health', { cookie: cookieUnentitled }), ENV, d)).status,
    ).toBe(403);
  });
});

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const pairFor = (mint: string) => ({
  chainId: 'solana',
  dexId: 'orca',
  pairAddress: 'A'.repeat(44),
  baseToken: { address: mint, symbol: 'X' },
  quoteToken: { address: USDC, symbol: 'USDC' },
  priceUsd: '100.01',
  liquidity: { usd: 500_000 },
});
const upstream = (async (url: string) =>
  new Response(JSON.stringify([pairFor(url.split('/').pop()!)]), { status: 200 })) as never;

const MENV: MarketsEnv = {
  MARKETS_OVERVIEW: '1',
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  NATIVE_AUTH_ENABLED: 'true',
  get PORTFOLIO_ACCOUNTS_DB() {
    return h.db as never;
  },
};
const mDeps = (keys: unknown[], over: Partial<OverviewDeps> = {}): MarketsDeps => ({
  fetchKeys: (async () => keys) as never,
  now: () => NOW,
  id: () => 'req-1',
  cache: createOverviewCache({
    fetchImpl: upstream,
    now: () => NOW.getTime(),
    ttlMs: 60_000,
    maxStaleMs: 600_000,
    minRefreshIntervalMs: 15_000,
    deadlineMs: 8_000,
    ...over,
  }),
});
const getM = (c: Cred) =>
  new Request('https://app.example.com/api/v1/markets/overview', {
    method: 'GET',
    headers: hdrs(c, { origin: 'https://app.example.com', 'sec-fetch-site': 'same-origin' }),
  });

describe('markets overview: dual-gate matrix', () => {
  it('admits a native ENTITLED session', async () => {
    const s = await signer();
    const r = await handleMarkets(getM({ cookie: cookieEntitled }), MENV, mDeps(s.keys));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.observations).toHaveLength(INSTRUMENTS.length);
  });
  it('403s unentitled and revoked; 401 anonymous; bad JWT never falls through', async () => {
    const s = await signer();
    const other = await signer();
    const forged = await other.sign(good());
    expect(
      (await handleMarkets(getM({ cookie: cookieUnentitled }), MENV, mDeps(s.keys))).status,
    ).toBe(403);
    expect((await handleMarkets(getM({ cookie: cookieRevoked }), MENV, mDeps(s.keys))).status).toBe(
      403,
    );
    expect((await handleMarkets(getM({}), MENV, mDeps(s.keys))).status).toBe(401);
    expect(
      (await handleMarkets(getM({ jwt: forged, cookie: cookieEntitled }), MENV, mDeps(s.keys)))
        .status,
    ).toBe(401);
  });
});

describe('owner-keyed legacy handlers STAY Access-JWT-only', () => {
  it('portfolio/session 401s a native-only caller, even entitled', async () => {
    const s = await signer();
    const r = await handleSession(
      getP('/api/v1/portfolio/session', { cookie: cookieEntitled }),
      ENV,
      deps(s.keys),
    );
    expect(r.status).toBe(401);
  });
  it('portfolio/session 401s when a bad JWT rides a valid native session', async () => {
    const s = await signer();
    const other = await signer();
    const forged = await other.sign(good());
    const r = await handleSession(
      getP('/api/v1/portfolio/session', { jwt: forged, cookie: cookieEntitled }),
      ENV,
      deps(s.keys),
    );
    expect(r.status).toBe(401);
  });
});

describe('limiter key: cross-principal isolation, never an email/token/IP', () => {
  it('access -> verified iss#sub; native -> native#userId; service token -> null (fail closed)', () => {
    const access: DualIdentity = { kind: 'access', ownerKey: 'https://team#sub-1' };
    const native: DualIdentity = { kind: 'native', userId: 'u1' };
    const service: DualIdentity = { kind: 'access', ownerKey: null };
    expect(dualLimiterKey(access)).toBe('https://team#sub-1');
    expect(dualLimiterKey(native)).toBe('native#u1');
    expect(dualLimiterKey(service)).toBeNull();
    // Distinct principals never share a bucket, across or within paths.
    const keys = new Set([
      dualLimiterKey(access),
      dualLimiterKey(native),
      dualLimiterKey({ kind: 'access', ownerKey: 'https://team#sub-2' }),
      dualLimiterKey({ kind: 'native', userId: 'u2' }),
    ]);
    expect(keys.size).toBe(4);
  });
});

describe('feature flag: health + networks enforce PORTFOLIO_API_ENABLED before the gate', () => {
  it('503 disabled with the flag off, even for a valid JWT and for a native entitled session', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const envOff: Env = { ...ENV, PORTFOLIO_API_ENABLED: 'false' };
    const d = deps(s.keys);
    for (const cred of [{ jwt }, { cookie: cookieEntitled }] as const) {
      const h = await handleHealth(getP('/api/v1/health', cred), envOff, d);
      expect(h.status).toBe(503);
      expect((await h.json()).error.code).toBe('disabled');
      const n = await handleNetworks(getP('/api/v1/networks', cred), envOff, d);
      expect(n.status).toBe(503);
      expect((await n.json()).error.code).toBe('disabled');
    }
    // resolve already enforced it (baseline contract)
    const r = await handleResolve(postResolve({ jwt }), envOff, d);
    expect(r.status).toBe(503);
  });
});
