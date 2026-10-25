import { describe, expect, it, vi } from 'vitest';
import { handleOverview, type Deps, type Env } from '../server/markets/handler';
import { createOverviewCache, type OverviewDeps } from '../server/markets/overview';
import { INSTRUMENTS } from '../server/markets/instruments';

const TEAM = 'team-example.cloudflareaccess.com';
const AUD = 'aud123';
const ENV: Env = { MARKETS_OVERVIEW: '1', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
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
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as {
    n: string;
    e: string;
    kty: string;
  };
  const sign = async (payload: Record<string, unknown>, kid = 'k1') => {
    const head = enc({ alg: 'RS256', kid, typ: 'JWT' });
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
const NOW = new Date('2026-10-25T00:12:00Z');
const goodClaims = () => ({
  iss: `https://${TEAM}`,
  aud: AUD,
  exp: Math.floor(NOW.getTime() / 1000) + 600,
  sub: 'user-1',
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

function makeDeps(keys: unknown, overview?: Partial<OverviewDeps>): Deps {
  return {
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
      ...overview,
    }),
  };
}
const get = (jwt: string | null, headers: Record<string, string> = {}, url = 'https://app.example.com/api/v1/markets/overview') =>
  new Request(url, { method: 'GET', headers: { ...(jwt ? { 'cf-access-jwt-assertion': jwt } : {}), ...headers } });

describe('markets overview route gate', () => {
  it('rejects non-GET methods', async () => {
    const s = await signer();
    const res = await handleOverview(new Request('https://app.example.com/api/v1/markets/overview', { method: 'POST' }), ENV, makeDeps(s.keys));
    expect(res.status).toBe(405);
  });
  it('fails closed when the kill switch is off', async () => {
    const s = await signer();
    const jwt = await s.sign(goodClaims());
    const res = await handleOverview(get(jwt), { ...ENV, MARKETS_OVERVIEW: '0' }, makeDeps(s.keys));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('disabled');
  });
  it('fails closed without Access configuration', async () => {
    const s = await signer();
    const jwt = await s.sign(goodClaims());
    const res = await handleOverview(get(jwt), { MARKETS_OVERVIEW: '1' }, makeDeps(s.keys));
    expect(res.status).toBe(503);
  });
  it('rejects a missing or invalid JWT and never contacts the vendor', async () => {
    const s = await signer();
    const fetchSpy = vi.fn(upstream);
    const d = makeDeps(s.keys, { fetchImpl: fetchSpy });
    expect((await handleOverview(get(null), ENV, d)).status).toBe(401);
    expect((await handleOverview(get('garbage'), ENV, d)).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('rejects cross-origin and cross-site requests', async () => {
    const s = await signer();
    const jwt = await s.sign(goodClaims());
    expect(
      (await handleOverview(get(jwt, { origin: 'https://evil.example' }), ENV, makeDeps(s.keys))).status,
    ).toBe(403);
    expect(
      (await handleOverview(get(jwt, { 'sec-fetch-site': 'cross-site' }), ENV, makeDeps(s.keys))).status,
    ).toBe(403);
  });
  it('serves a strictly-shaped payload for a signed-in same-origin user', async () => {
    const s = await signer();
    const jwt = await s.sign(goodClaims());
    const res = await handleOverview(
      get(jwt, { origin: 'https://app.example.com', 'sec-fetch-site': 'same-origin' }),
      ENV,
      makeDeps(s.keys),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.source).toBe('DexScreener');
    expect(body.status).toBe('available');
    expect(body.observations).toHaveLength(INSTRUMENTS.length);
    const sol = body.observations.find((o: { instrument: string }) => o.instrument === 'SOL');
    expect(sol.value).toBe('100.01');
    expect(sol.sourceUpdatedAt).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('maps a total upstream failure to 502, never fabricated prices', async () => {
    const s = await signer();
    const jwt = await s.sign(goodClaims());
    const d = makeDeps(s.keys, { fetchImpl: (async () => new Response('x', { status: 500 })) as never });
    const res = await handleOverview(get(jwt), ENV, d);
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('source_unavailable');
  });
});
