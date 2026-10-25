import { describe, expect, it, vi } from 'vitest';
import { keccak256Utf8 } from '../server/portfolio/keccak';
import { checkEvmAddress, toChecksumAddress } from '../server/portfolio/address';
import { formatUnits, valueUsd } from '../server/portfolio/units';
import { parseResolveRequest } from '../server/portfolio/contract';
import {
  handleHealth,
  handleSession,
  handleNetworks,
  handleResolve,
  defaultDeps,
  type Deps,
  type Env,
} from '../server/portfolio/handler';
import { mockProvider } from '../server/portfolio/provider';
import { readExpiresAt } from '../server/portfolio/access';
import { createLiveProvider } from '../server/portfolio/live-provider';

const TEAM = 'team-example.cloudflareaccess.com';
const AUD = 'aud123';
const ENV: Env = { PORTFOLIO_API_ENABLED: 'true', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const A = (last: string) => '0x' + '1'.repeat(39) + last;
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
  const sign = async (
    payload: Record<string, unknown>,
    kid = 'k1',
    alg = 'RS256',
    extra: Record<string, unknown> = {},
  ) => {
    const head = enc({ alg, kid, typ: 'JWT', ...extra });
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
const NOW = new Date('2026-10-23T12:00:00Z');
const good = (over: Record<string, unknown> = {}) => ({
  iss: `https://${TEAM}`,
  aud: [AUD],
  exp: Math.floor(NOW.getTime() / 1000) + 600,
  ...over,
});
const deps = (keys: unknown[], over: Partial<Deps> = {}): Deps => ({
  ...defaultDeps(),
  fetchKeys: async () => keys as never,
  now: () => NOW,
  id: () => 'req-1',
  ...over,
});
const post = (body: unknown, jwt: string | null, headers: Record<string, string> = {}) =>
  new Request('https://app.example/api/v1/portfolio/resolve', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(jwt ? { 'cf-access-jwt-assertion': jwt } : {}),
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const valid = { network: 'ethereum', addresses: [A('2')], currency: 'USD' };

describe('keccak and EIP-55 addresses', () => {
  it('matches known keccak-256 vectors', () => {
    expect(keccak256Utf8('')).toBe(
      'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
    expect(keccak256Utf8('abc')).toBe(
      '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    );
  });
  it('matches the EIP-55 reference addresses', () => {
    for (const a of [
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
      '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
    ])
      expect(toChecksumAddress(a.slice(2))).toBe(a);
  });
  it('rejects bad format, bad checksum; accepts lowercase', () => {
    expect(checkEvmAddress('0x123')).toEqual({ ok: false, reason: 'format' });
    expect(checkEvmAddress(42)).toEqual({ ok: false, reason: 'format' });
    expect(checkEvmAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAEd')).toEqual({
      ok: false,
      reason: 'checksum',
    });
    expect(checkEvmAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toEqual({
      ok: true,
      address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    });
  });
});

describe('units', () => {
  it('formats and values with bigint only', () => {
    expect(formatUnits(1_500_000_000_000_000_000n, 18)).toBe('1.5');
    expect(formatUnits(0n, 18)).toBe('0');
    expect(formatUnits(1n, 18)).toBe('0.000000000000000001');
    expect(valueUsd(10n ** 30n, 6, '1')).toBe('1000000000000000000000000');
    expect(valueUsd(1_234_560_000n, 6, '1')).toBe('1234.56');
    expect(valueUsd(1n, 18, '2000')).toBe('0');
  });
});

describe('request contract', () => {
  it('validates, dedupes and canonicalizes', () => {
    const r = parseResolveRequest(
      JSON.stringify({ ...valid, addresses: [A('2'), A('2').toUpperCase().replace('0X', '0x')] }),
    );
    expect(r.ok && r.value.addresses.length).toBe(1);
  });
  it.each([
    ['not json', 400, 'bad_json'],
    ['[]', 400, 'bad_shape'],
    [JSON.stringify({ ...valid, network: 'bitcoin' }), 400, 'unsupported_network'],
    [JSON.stringify({ ...valid, currency: 'EUR' }), 400, 'unsupported_currency'],
    [JSON.stringify({ ...valid, addresses: [] }), 400, 'bad_addresses'],
    [
      JSON.stringify({ ...valid, addresses: Array.from({ length: 6 }, (_, i) => A(String(i))) }),
      400,
      'too_many_addresses',
    ],
    [JSON.stringify({ ...valid, addresses: ['vitalik.eth'] }), 400, 'bad_address'],
    [JSON.stringify({ ...valid, rpcUrl: 'http://x' }), 400, 'unknown_field'],
    [JSON.stringify({ ...valid, pad: 'x'.repeat(3000) }), 413, 'body_too_large'],
  ])('rejects %#', (body, status, code) => {
    const r = parseResolveRequest(body as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect([r.status, r.code]).toEqual([status, code]);
  });

  it('accepts a solana request with a base58 address and keeps it verbatim', () => {
    const addr = 'So11111111111111111111111111111111111111112';
    const r = parseResolveRequest(
      JSON.stringify({ network: 'solana', addresses: [addr], currency: 'USD' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ network: 'solana', addresses: [addr], currency: 'USD' });
  });
  it.each([
    [JSON.stringify({ network: 'solana', addresses: [A('1')], currency: 'USD' }), 'bad_address'],
    [JSON.stringify({ network: 'solana', addresses: ['0xabc'], currency: 'USD' }), 'bad_address'],
    [JSON.stringify({ network: 'solana', addresses: ['has0OIlchars'.repeat(3)], currency: 'USD' }), 'bad_address'],
    [JSON.stringify({ network: 'solana', addresses: ['short'], currency: 'USD' }), 'bad_address'],
    [
      JSON.stringify({
        network: 'ethereum',
        addresses: ['So11111111111111111111111111111111111111112'],
        currency: 'USD',
      }),
      'bad_address',
    ],
  ])('rejects cross-network or malformed solana addresses %#', (body, code) => {
    const r = parseResolveRequest(body as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it('resolves solana through the solana mock provider with solana warnings and null chainId', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const addr = 'So11111111111111111111111111111111111111112';
    const res = await handleResolve(
      post({ network: 'solana', addresses: [addr], currency: 'USD' }, jwt),
      ENV,
      deps(s.keys),
    );
    expect(res.status).toBe(200);
    const b = (await res.json()) as {
      network: string;
      chainId: number | null;
      provider: string;
      simulated: boolean;
      warnings: string[];
      wallets: { address: string; assets: { symbol: string }[] }[];
    };
    expect(b.network).toBe('solana');
    expect(b.chainId).toBeNull();
    expect(b.provider).toBe('mock-fixtures-solana');
    expect(b.simulated).toBe(true);
    expect(b.warnings[0]).toContain('SIMULATED');
    expect(b.wallets[0]!.address).toBe(addr);
    expect(b.wallets[0]!.assets[0]!.symbol).toBe('SOL');
  });

  it('uses the solana live provider when live data is on', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const addr = 'So11111111111111111111111111111111111111112';
    const solLive = {
      name: 'sol-live-stub',
      simulated: false,
      async fetchWallets(addresses: string[]) {
        return {
          ok: true as const,
          provider: 'sol-live-stub',
          simulated: false,
          observedAt: '2026-10-24T00:00:00.000Z',
          wallets: [{ address: addresses[0]!, assets: [], partial: false, warnings: [] }],
        };
      },
    };
    const res = await handleResolve(
      post({ network: 'solana', addresses: [addr], currency: 'USD' }, jwt),
      { ...ENV, PORTFOLIO_LIVE_DATA: '1' },
      deps(s.keys, { solanaLiveProvider: solLive }),
    );
    expect(res.status).toBe(200);
    const b = (await res.json()) as { provider: string; warnings: string[]; simulated: boolean };
    expect(b.provider).toBe('sol-live-stub');
    expect(b.simulated).toBe(false);
    expect(b.warnings[0]).toContain('Only the SOL balance is checked');
  });
});

describe('endpoint security and behavior', () => {
  it('is off unless explicitly enabled, and fails closed without Access config', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    expect((await handleResolve(post(valid, jwt), {}, deps(s.keys))).status).toBe(503);
    expect(
      (await handleResolve(post(valid, jwt), { PORTFOLIO_API_ENABLED: 'true' }, deps(s.keys)))
        .status,
    ).toBe(503);
    expect(
      (
        await handleResolve(
          post(valid, jwt),
          { ...ENV, PORTFOLIO_API_ENABLED: 'false' },
          deps(s.keys),
        )
      ).status,
    ).toBe(503);
  });
  it('rejects missing, forged, expired, wrong-audience, wrong-issuer, wrong-kid and none-alg tokens', async () => {
    const s = await signer();
    const other = await signer();
    const cases: (string | null)[] = [
      null,
      'garbage',
      await other.sign(good()), // signed by a different key, same kid
      await s.sign(good({ exp: 1 })),
      await s.sign(good({ aud: ['nope'] })),
      await s.sign(good({ iss: 'https://evil.example' })),
      await s.sign(good(), 'unknown-kid'),
      await s.sign(good(), 'k1', 'none'),
    ];
    for (const jwt of cases) {
      const r = await handleResolve(post(valid, jwt), ENV, deps(s.keys));
      expect(r.status).toBe(401);
    }
    // an email header alone is not authentication
    expect(
      (
        await handleResolve(
          post(valid, null, { 'cf-access-authenticated-user-email': 'a@b.c' }),
          ENV,
          deps(s.keys),
        )
      ).status,
    ).toBe(401);
  });
  it('limits methods, content type, and origin', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const d = deps(s.keys);
    expect(
      (await handleResolve(new Request('https://app.example/api/v1/portfolio/resolve'), ENV, d))
        .status,
    ).toBe(405);
    expect(
      (await handleResolve(post('x', jwt, { 'content-type': 'text/plain' }), ENV, d)).status,
    ).toBe(415);
    expect(
      (await handleResolve(post(valid, jwt, { origin: 'https://evil.example' }), ENV, d)).status,
    ).toBe(403);
    expect(
      (
        await handleHealth(
          new Request('https://app.example/api/v1/health', { method: 'POST' }),
          ENV,
          d,
        )
      ).status,
    ).toBe(405);
  });
  it('returns a simulated, no-store, schema-complete answer for a valid authenticated request', async () => {
    const s = await signer();
    const r = await handleResolve(
      post({ ...valid, addresses: [A('2'), A('3')] }, await s.sign(good())),
      ENV,
      deps(s.keys),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const b = await r.json();
    expect(b).toMatchObject({
      schemaVersion: 1,
      mode: 'mock',
      simulated: true,
      chainId: 1,
      provider: 'mock-fixtures',
    });
    expect(b.warnings[0]).toMatch(/SIMULATED/);
    expect(b.totals.unpricedAssetCount).toBe(1); // the mystery token
    expect(
      b.wallets[1].assets.find((a: { symbol: string }) => a.symbol === 'MYST').value,
    ).toBeNull();
    expect(b.totals.note).toMatch(/not total net worth/);
  });
  it('covers empty, large and partial fixtures without inventing data', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const empty = await (
      await handleResolve(post({ ...valid, addresses: [A('0')] }, jwt), ENV, deps(s.keys))
    ).json();
    expect(empty.wallets[0].assets).toEqual([]);
    expect(empty.totals.recognizedPricedSubtotalUsd).toBeNull();
    const big = await (
      await handleResolve(post({ ...valid, addresses: [A('4')] }, jwt), ENV, deps(s.keys))
    ).json();
    expect(big.wallets[0].assets[0].amount).toBe('1000000000000000000000000');
    const part = await (
      await handleResolve(post({ ...valid, addresses: [A('5')] }, jwt), ENV, deps(s.keys))
    ).json();
    expect(part.partial).toBe(true);
  });
  it('maps provider failures to 429/503/504 and never substitutes data', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const status = async (last: string) =>
      handleResolve(post({ ...valid, addresses: [A(last)] }, jwt), ENV, deps(s.keys));
    const e = await status('e');
    expect(e.status).toBe(429);
    expect(e.headers.get('retry-after')).toBe('30');
    expect((await status('f')).status).toBe(503);
    expect((await status('d')).status).toBe(504);
    const slow = { ...mockProvider, fetchWallets: () => new Promise<never>(() => {}) };
    expect(
      (await handleResolve(post(valid, jwt), ENV, deps(s.keys, { provider: slow, timeoutMs: 20 })))
        .status,
    ).toBe(504);
    const body = await (await status('f')).json();
    expect(body.wallets).toBeUndefined();
  });
  it('does not put addresses or tokens in error bodies or console logs', async () => {
    const s = await signer();
    const logs: unknown[] = [];
    const orig = [console.log, console.error, console.warn];
    console.log = console.error = console.warn = (...a: unknown[]) => void logs.push(a);
    try {
      const r = await handleResolve(
        post({ ...valid, addresses: ['0xNOTANADDRESS'] }, await s.sign(good())),
        ENV,
        deps(s.keys),
      );
      expect(JSON.stringify(await r.json())).not.toContain('NOTANADDRESS');
    } finally {
      [console.log, console.error, console.warn] = orig;
    }
    expect(logs).toEqual([]);
  });
  it('health and networks are gated and reveal nothing private', async () => {
    const s = await signer();
    const d = deps(s.keys);
    const jwt = await s.sign(good());
    const get = (p: string, j: string | null) =>
      new Request('https://app.example' + p, {
        headers: j ? { 'cf-access-jwt-assertion': j } : {},
      });
    expect((await handleHealth(get('/api/v1/health', null), ENV, d)).status).toBe(401);
    const h = await (await handleHealth(get('/api/v1/health', jwt), ENV, d)).json();
    expect(Object.keys(h).sort()).toEqual(['aave', 'mode', 'requestId', 'status']);
    const n = await (await handleNetworks(get('/api/v1/networks', jwt), ENV, d)).json();
    expect(n.networks).toEqual([
      { id: 'ethereum', chainId: 1, status: 'mock' },
      { id: 'solana', chainId: null, status: 'mock' },
    ]);
  });
});

import { makeKeyFetcher } from '../server/portfolio/access';

const streamOf = (parts: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      parts.forEach((p) => c.enqueue(p));
      c.close();
    },
  });
const certsRes = (keys: unknown[]) => new Response(JSON.stringify({ keys }));

describe('hardening: bounded body and bounded key fetch', () => {
  it('rejects an oversize body by header and by streaming without buffering it all', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const d = deps(s.keys);
    const big = new Request('https://app.example/api/v1/portfolio/resolve', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-access-jwt-assertion': jwt,
        'content-length': '999999',
      },
      body: '{}',
    });
    expect((await handleResolve(big, ENV, d)).status).toBe(413);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1024;
        c.enqueue(new Uint8Array(1024).fill(97));
        if (pulled > 1024 * 1024) c.close();
      },
    });
    const chunked = new Request('https://app.example/api/v1/portfolio/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': jwt },
      body,
      duplex: 'half',
    } as RequestInit);
    expect((await handleResolve(chunked, ENV, d)).status).toBe(413);
    expect(pulled).toBeLessThan(64 * 1024);
  });
  it('picks up a rotated key on first use of a new kid', async () => {
    const s = await signer();
    const jwt = await s.sign(good(), 'rotated');
    let t = 5_000_000;
    let serveNew = false;
    const f = makeKeyFetcher(
      (async () =>
        certsRes(
          serveNew
            ? [{ ...s.keys[0]!, kid: 'rotated' }]
            : [{ kid: 'old', kty: 'RSA', n: 'x', e: 'AQAB' }],
        )) as unknown as typeof fetch,
      () => t,
    );
    await f(TEAM);
    serveNew = true;
    t += 120_000;

    expect((await handleResolve(post(valid, jwt), ENV, deps([], { fetchKeys: f }))).status).toBe(
      200,
    );
  });
});

describe('hardening: media type, stream errors, token shape', () => {
  it('requires the exact JSON media type', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    for (const ct of ['application/jsonBAD', 'text/plain']) {
      const r = await handleResolve(post(valid, jwt, { 'content-type': ct }), ENV, deps(s.keys));
      expect(r.status).toBe(415);
    }
    const ok = await handleResolve(
      post(valid, jwt, { 'content-type': 'application/json; charset=utf-8' }),
      ENV,
      deps(s.keys),
    );
    expect(ok.status).toBe(200);
  });
  it('turns a body stream error into a contract JSON no-store response', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('boom');
      },
    });
    const req = new Request('https://app.example/api/v1/portfolio/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': jwt },
      body,
      duplex: 'half',
    } as RequestInit);
    const r = await handleResolve(req, ENV, deps(s.keys));
    expect(r.status).toBe(408);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await r.json()).requestId).toBe('req-1');
  });
  it('rejects crit headers and oversize tokens', async () => {
    const s = await signer();
    const big = await s.sign(good({ pad: 'x'.repeat(9000) }));
    expect((await handleResolve(post(valid, big), ENV, deps(s.keys))).status).toBe(401);
  });
});

describe('key fetcher limits', () => {
  const key = { kid: 'a', kty: 'RSA', n: 'x', e: 'AQAB' };
  const H = 60 * 60 * 1000;
  it('caches for an hour and throttles forced refreshes, including after failures', async () => {
    let calls = 0;
    let t = 1_000_000;
    let fail = false;
    const f = makeKeyFetcher(
      (async () => {
        calls++;
        if (fail) throw new Error('down');
        return certsRes([key]);
      }) as unknown as typeof fetch,
      () => t,
    );
    await f('t.example');
    await f('t.example');
    expect(calls).toBe(1);
    await f('t.example', true);
    expect(calls).toBe(1);
    t += 61_000;
    fail = true;
    await f('t.example', true);
    await f('t.example', true);
    await f('t.example', true);
    expect(calls).toBe(2); // failed attempt still starts the cooldown
    t += 61_000;
    await f('t.example', true);
    expect(calls).toBe(3);
  });
  it('shares one in-flight fetch between concurrent callers', async () => {
    let calls = 0;
    const f = makeKeyFetcher((async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return certsRes([key]);
    }) as unknown as typeof fetch);
    await Promise.all([f('t.example'), f('t.example'), f('t.example', true)]);
    expect(calls).toBe(1);
  });
  it('serves stale keys on failure only up to 6 h, then fails closed', async () => {
    let t = 0;
    let fail = false;
    const f = makeKeyFetcher(
      (async () => {
        if (fail) throw new Error('down');
        return certsRes([key]);
      }) as unknown as typeof fetch,
      () => t,
    );
    await f('t.example');
    fail = true;
    t += 2 * H;
    expect((await f('t.example')).length).toBe(1);
    t += 5 * H;
    await expect(f('t.example')).rejects.toThrow();
  });
  it('rejects oversize certs, caps keys at 10, treats redirects as failures', async () => {
    await expect(
      makeKeyFetcher(
        (async () =>
          new Response(streamOf([new Uint8Array(40 * 1024).fill(32)]))) as unknown as typeof fetch,
      )('a.example'),
    ).rejects.toThrow();
    const many = makeKeyFetcher((async () =>
      certsRes(
        Array.from({ length: 50 }, (_, i) => ({ ...key, kid: 'k' + i })),
      )) as unknown as typeof fetch);
    expect((await many('a.example')).length).toBe(10);
    let init: RequestInit | undefined;
    await makeKeyFetcher(
      (async (_u: string, i: RequestInit) => ((init = i), certsRes([]))) as unknown as typeof fetch,
    )('a.example');
    expect(init?.redirect).toBe('manual'); // workerd does not support 'error'
    const redir = makeKeyFetcher(
      (async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/' },
        })) as unknown as typeof fetch,
    );
    await expect(redir('c.example')).rejects.toThrow();
  });
  it('times out a hung fetch and a stalled body', async () => {
    const hung = makeKeyFetcher(
      (() => new Promise(() => {})) as unknown as typeof fetch,
      Date.now,
      50,
    );
    await expect(hung('a.example')).rejects.toThrow('deadline');
    const stalled = makeKeyFetcher(
      (async () => new Response(new ReadableStream({ start() {} }))) as unknown as typeof fetch,
      Date.now,
      50,
    );
    await expect(stalled('b.example')).rejects.toThrow('deadline');
  });
  it('a hung key fetch makes the endpoint answer 401, not hang', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const f = makeKeyFetcher(
      (() => new Promise(() => {})) as unknown as typeof fetch,
      Date.now,
      50,
    );
    expect((await handleResolve(post(valid, jwt), ENV, deps([], { fetchKeys: f }))).status).toBe(
      401,
    );
  });
  it('times out a stalled request body', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const req = new Request('https://app.example/api/v1/portfolio/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': jwt },
      body,
      duplex: 'half',
    } as RequestInit);
    const r = await handleResolve(req, ENV, deps(s.keys, { bodyDeadlineMs: 50 }));
    expect(r.status).toBe(408);
  });
  it('rejects a really signed token carrying a crit header', async () => {
    const s = await signer();
    const jwt = await s.sign(good(), 'k1', 'RS256', { crit: ['exp'] });
    expect((await handleResolve(post(valid, jwt), ENV, deps(s.keys))).status).toBe(401);
    expect((await handleResolve(post(valid, await s.sign(good())), ENV, deps(s.keys))).status).toBe(
      200,
    );
  });
});

import { parseApiSuccess } from '../features/portfolio/api-client';

describe('browser response validation', () => {
  it('accepts the real server answer and rejects malformed, partial and mislabeled ones', async () => {
    const s = await signer();
    const r = await handleResolve(post(valid, await s.sign(good())), ENV, deps(s.keys));
    const body = await r.json();
    expect(parseApiSuccess(body)).not.toBeNull();
    const bad: unknown[] = [
      null,
      '<html>Access login</html>',
      { wallets: [] },
      { ...body, wallets: [] },
      { ...body, simulated: undefined },
      { ...body, mode: undefined },
      { ...body, mode: 'mock', simulated: false },
      { ...body, mode: 'live', simulated: true },
      { ...body, totals: undefined },
      { ...body, warnings: 'x' },
      { ...body, schemaVersion: 2 },
      { ...body, wallets: [{ ...body.wallets[0], assets: [{ amount: '1' }] }] },
      {
        ...body,
        wallets: [
          {
            ...body.wallets[0],
            assets: [{ ...(body.wallets[0].assets[0] ?? {}), amount: '1e999' }],
          },
        ],
      },
    ];
    for (const b of bad) expect(parseApiSuccess(b)).toBeNull();
  });
});

describe('response headers', () => {
  it('sets no-store, nosniff, no-referrer, noindex, no-embedding on success and on errors', async () => {
    const s = await signer();
    const ok = await handleResolve(post(valid, await s.sign(good())), ENV, deps(s.keys));
    const bad = await handleResolve(post(valid, null), ENV, deps(s.keys));
    expect(ok.status).toBe(200);
    expect(bad.status).toBe(401);
    for (const r of [ok, bad]) {
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
      expect(r.headers.get('x-robots-tag')).toMatch(/noindex/);
      expect(r.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
    }
  });
  it('rejects HS256 tokens signed with the public key material and unsigned tokens', async () => {
    const s = await signer();
    const hs = await s.sign(good(), 'k1', 'HS256');
    const none = (await s.sign(good(), 'k1', 'none')).split('.').slice(0, 2).join('.') + '.';
    for (const t of [hs, none])
      expect((await handleResolve(post(valid, t), ENV, deps(s.keys))).status).toBe(401);
  });
});

import { checkAccessJwt, isValidTeamHost } from '../server/portfolio/access';

describe('auth diagnostics: config validation and finite reasons', () => {
  const cfg = { teamDomain: TEAM, aud: AUD };
  it('accepts only a bare Access team host', () => {
    expect(isValidTeamHost('sola-lens-preview-pages.cloudflareaccess.com')).toBe(true);
    for (const bad of [
      'https://team.cloudflareaccess.com',
      'team.cloudflareaccess.com/',
      'team.cloudflareaccess.com:443',
      'team.cloudflareaccess.com/cdn-cgi',
      'evil.example.com',
      'a.b.cloudflareaccess.com.evil.com',
      ' team.cloudflareaccess.com',
      '',
    ])
      expect(isValidTeamHost(bad)).toBe(false);
  });
  it('a malformed team host is a 503 config error, not a 401 for everyone', async () => {
    const s = await signer();
    const r = await handleResolve(
      post(valid, await s.sign(good())),
      { ...ENV, ACCESS_TEAM_DOMAIN: `https://${TEAM}` },
      deps(s.keys),
    );
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('not_configured');
  });
  it('returns finite reason categories and never token or claim values', async () => {
    const s = await signer();
    const keys = deps(s.keys).fetchKeys;
    const now = Math.floor(NOW.getTime() / 1000);
    const secret = 'super-secret-audience-value';
    const cases: [string | null, string][] = [
      [null, 'missing_assertion'],
      ['x'.repeat(9000), 'token_too_large'],
      [await s.sign(good({ exp: 1 })), 'jose_ERR_JWT_EXPIRED:exp'],
      [await s.sign(good({ aud: [secret] })), 'jose_ERR_JWT_CLAIM_VALIDATION_FAILED:aud'],
      [
        await s.sign(good({ iss: `https://${secret}` })),
        'jose_ERR_JWT_CLAIM_VALIDATION_FAILED:iss',
      ],
    ];
    for (const [tok, want] of cases) {
      const got = await checkAccessJwt(tok, cfg, keys, now);
      expect(got).toBe(want);
      expect(got).not.toContain(secret);
    }
    const down = async () => {
      throw new Error('down');
    };
    expect(await checkAccessJwt(await s.sign(good()), cfg, down as never, now)).toBe(
      'key_fetch_failed:fetch_error',
    );
    expect(await checkAccessJwt(await s.sign(good()), cfg, keys, now)).toBeNull();
  });
  it('logs each category at most once a minute and logs no private values', async () => {
    const s = await signer();
    const lines: unknown[][] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => void lines.push(a);
    try {
      let t = Date.parse('2030-01-01T00:00:00Z');
      const d = deps(s.keys, { now: () => new Date(t) });
      const jwt = await s.sign(good({ exp: 1 }));
      for (let i = 0; i < 20; i++) await handleResolve(post(valid, jwt), ENV, d);
      expect(lines.length).toBe(1);
      t += 61_000;
      await handleResolve(post(valid, jwt), ENV, { ...d, now: () => new Date(t) });
      expect(lines.length).toBe(2);
      const text = JSON.stringify(lines);
      expect(text).not.toContain(jwt.slice(0, 20));
      expect(text).not.toContain('0x');
      expect(text).toMatch(/auth_reject:jose_ERR_JWT_EXPIRED:exp/);
    } finally {
      console.warn = orig;
    }
  });
});

describe('key fetch failure sub-categories', () => {
  it('maps failures to a fixed set, never raw error text', async () => {
    const cfg = { teamDomain: TEAM, aud: AUD };
    const s = await signer();
    const tok = await s.sign(good());
    const now = Math.floor(NOW.getTime() / 1000);
    const mk = (f: () => Promise<Response>) =>
      makeKeyFetcher(f as unknown as typeof fetch, Date.now, 50);
    const cases: [() => Promise<Response>, string][] = [
      [() => new Promise(() => {}), 'key_fetch_failed:timeout'],
      [async () => new Response('no', { status: 500 }), 'key_fetch_failed:http_status'],
      [async () => new Response(null, { status: 302 }), 'key_fetch_failed:http_status'],
      [async () => new Response('{not json'), 'key_fetch_failed:parse'],
      [async () => new Response(new Uint8Array(40 * 1024)), 'key_fetch_failed:too_large'],
      [
        async () => {
          throw new Error('secret-host-details');
        },
        'key_fetch_failed:fetch_error',
      ],
    ];
    for (const [f, want] of cases) {
      const got = await checkAccessJwt(tok, cfg, mk(f), now);
      expect(got).toBe(want);
      expect(got).not.toContain('secret');
    }
  });
});

describe('/api/v1/session', () => {
  const get = (j: string | null, method = 'GET') =>
    new Request('https://app.example/api/v1/session', {
      method,
      headers: j ? { 'cf-access-jwt-assertion': j } : {},
    });
  it('rejects missing, forged and non-GET requests without revealing anything', async () => {
    const s = await signer();
    const d = deps(s.keys);
    expect((await handleSession(get(null), ENV, d)).status).toBe(401);
    const other = await signer();
    const forged = await other.sign(good({ email: 'a@b.co' }));
    const r = await handleSession(get(forged), ENV, d);
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain('a@b.co');
    expect((await handleSession(get(await s.sign(good()), 'POST'), ENV, d)).status).toBe(405);
  });
  it('returns only the verified email, no token or other claims, uncached', async () => {
    const s = await signer();
    const d = deps(s.keys);
    const jwt = await s.sign(good({ email: 'jun@example.com', sub: 'secret-sub', custom: 'x' }));
    const r = await handleSession(get(jwt), ENV, d);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({
      status: 'ok',
      via: 'cloudflare-access',
      identity: { email: 'jun@example.com' },
      expiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
      requestId: 'req-1',
    });
    expect(text).not.toContain(jwt);
    expect(text).not.toContain('secret-sub');
  });
  it.each([
    ['absent', undefined],
    ['non-string', { a: 1 }],
    ['not an email', 'not-an-email'],
    ['markup', '<b>x</b>@example.com'],
    ['newline', 'a@example.com\nbcc: x@y.zz'],
    ['too long', 'a'.repeat(300) + '@example.com'],
  ])(
    'a verified token with a %s email claim gives identity null, never an invented one',
    async (_n, v) => {
      const s = await signer();
      const d = deps(s.keys);
      const jwt = await s.sign(good(v === undefined ? {} : { email: v }));
      const body = await (await handleSession(get(jwt), ENV, d)).json();
      expect(body.identity).toBeNull();
    },
  );
  it('is switched off with the kill switch', async () => {
    const s = await signer();
    const r = await handleSession(
      get(await s.sign(good())),
      { ...ENV, PORTFOLIO_API_ENABLED: 'false' },
      deps(s.keys),
    );
    expect(r.status).toBe(503);
  });
});

describe('readExpiresAt', () => {
  const tok = (payload: unknown) =>
    `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`;
  it('returns an ISO time for a finite positive exp and nothing else', () => {
    expect(readExpiresAt(tok({ exp: 1_800_000_000, email: 'a@b.co' }))).toBe(
      '2027-01-15T08:00:00.000Z',
    );
  });
  it.each([[undefined], ['soon'], [0], [-5], [1e20], [null]])('rejects exp %s', (v) => {
    expect(readExpiresAt(tok(v === undefined ? {} : { exp: v }))).toBeNull();
  });
  it('rejects a missing or garbage token', () => {
    expect(readExpiresAt(null)).toBeNull();
    expect(readExpiresAt('nope')).toBeNull();
  });
});

describe('live data kill switch', () => {
  const fakeRpc = (async (_u: string, init: RequestInit) => {
    const req = JSON.parse(String(init.body)) as { id: number; params: [{ data: string }] };
    const w = (x: bigint) => x.toString(16).padStart(64, '0');
    // Count the calls from the aggregate3 array length word, then answer each with one word.
    const n = Number(BigInt('0x' + req.params[0].data.slice(10 + 64, 10 + 128)));
    const words = Array.from({ length: n }, (_, i) =>
      i === 0
        ? 20_000_000n
        : i === 1
          ? BigInt(Math.floor(NOW.getTime() / 1000))
          : i === 2
            ? 10n ** 18n
            : 0n,
    );
    const els = words.map((x) => w(1n) + w(0x40n) + w(32n) + w(x));
    let off = BigInt(n * 32);
    const offs = els.map((e) => {
      const o = off;
      off += BigInt(e.length / 2);
      return w(o);
    });
    const result = '0x' + w(0x20n) + w(BigInt(n)) + offs.join('') + els.join('');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
  }) as unknown as typeof fetch;
  const call = async (env: Env) => {
    const s = await signer();
    const d = deps(s.keys, {
      liveProvider: createLiveProvider({ fetch: fakeRpc, now: () => NOW }),
    });
    const jwt = await s.sign(good());
    const r = await handleResolve(
      post({ network: 'ethereum', addresses: [A('1')], currency: 'USD' }, jwt),
      env,
      d,
    );
    return { status: r.status, body: await r.json(), d, jwt, s };
  };
  it('is OFF unless the variable is exactly "1": the simulated fixtures answer', async () => {
    for (const v of [undefined, '', 'true', 'yes', '0', ' 1', '01']) {
      const { body } = await call({ ...ENV, PORTFOLIO_LIVE_DATA: v });
      expect(body.mode).toBe('mock');
      expect(body.simulated).toBe(true);
    }
  });
  it('"1" selects the live provider and says what is and is not covered', async () => {
    const { status, body } = await call({ ...ENV, PORTFOLIO_LIVE_DATA: '1' });
    expect(status).toBe(200);
    expect(body.mode).toBe('live');
    expect(body.simulated).toBe(false);
    expect(body.provider).toBe('publicnode-rpc+chainlink');
    expect(body.warnings.join()).toMatch(/Only ETH, USDC, USDT, DAI and WETH/);
    expect(body.totals.note).toMatch(/not total net worth/);
  });
  it('a provider that throws is a bad response, not a timeout', async () => {
    const s = await signer();
    const d = deps(s.keys, {
      liveProvider: {
        fetchWallets: async () => {
          throw new Error('boom');
        },
      } as never,
    });
    const jwt = await s.sign(good());
    const r = await handleResolve(
      post({ network: 'ethereum', addresses: [A('1')], currency: 'USD' }, jwt),
      { ...ENV, PORTFOLIO_LIVE_DATA: '1' },
      d,
    );
    expect(r.status).not.toBe(504);
    expect(r.status).toBeGreaterThanOrEqual(500);
  });
  it('a timeout and a provider throw are both logged with a sanitized diagnostic and request id', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const run = async (fetchWallets: () => Promise<never>, extra: object) => {
        const r = await handleResolve(
          post({ network: 'ethereum', addresses: [A('1')], currency: 'USD' }, jwt),
          { ...ENV, PORTFOLIO_LIVE_DATA: '1' },
          deps(s.keys, { liveProvider: { fetchWallets } as never, ...extra }),
        );
        return { status: r.status, body: await r.json() };
      };
      const t = await run(() => new Promise<never>(() => {}), { timeoutMs: 20 });
      const x = await run(async () => {
        throw new Error('boom ' + A('1'));
      }, {});
      expect(t.status).toBe(504);
      expect(t.body.diagnostic).toEqual({ step: 'timeout' });
      expect(x.status).toBe(502);
      expect(x.body.diagnostic).toEqual({ step: 'exception' });
      const logs = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes('provider_failure'));
      expect(logs).toHaveLength(2);
      expect(logs[0]).toContain(t.body.requestId);
      expect(logs.join()).not.toContain(A('1').slice(2));
      expect(logs.join()).not.toContain('boom');
    } finally {
      warn.mockRestore();
    }
  });
  it('health and networks report live only when the switch is on', async () => {
    const s = await signer();
    const d = deps(s.keys, {
      liveProvider: createLiveProvider({ fetch: fakeRpc, now: () => NOW }),
    });
    const jwt = await s.sign(good());
    const req = () =>
      new Request('https://app.example/api/v1/networks', {
        headers: { 'cf-access-jwt-assertion': jwt },
      });
    expect((await (await handleNetworks(req(), ENV, d)).json()).networks[0].status).toBe('mock');
    expect(
      (await (await handleNetworks(req(), { ...ENV, PORTFOLIO_LIVE_DATA: '1' }, d)).json())
        .networks[0].status,
    ).toBe('live');
  });
});

describe('Aave V3 flag gating and response shape', () => {
  const AAVE_ENV: Env = { ...ENV, PORTFOLIO_AAVE_V3: '1' };
  it('off: no aave section is emitted and providers are asked without it', async () => {
    const s = await signer();
    let asked: boolean | undefined;
    const spy = {
      name: 'spy', simulated: true,
      async fetchWallets(addresses: string[], _sig: AbortSignal, opts?: { aave?: boolean }) {
        asked = opts?.aave;
        return mockProvider.fetchWallets(addresses, _sig, opts);
      },
    };
    const r = await handleResolve(
      post(valid, await s.sign(good())),
      { ...ENV, PORTFOLIO_AAVE_V3: 'yes' }, // only the exact string '1' counts
      deps(s.keys, { provider: spy as never }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(asked).toBe(false);
    expect(body.wallets[0].aave).toBeUndefined();
    expect(parseApiSuccess(body)).not.toBeNull();
  });
  it('on: the mock fixture section rides along, clearly simulated, in all three states', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const get = async (addr: string) => {
      const r = await handleResolve(
        post({ network: 'ethereum', addresses: [addr], currency: 'USD' }, jwt),
        AAVE_ENV,
        deps(s.keys),
      );
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(parseApiSuccess(body)).not.toBeNull(); // the strict parser accepts the section
      expect(body.simulated).toBe(true);
      return body.wallets[0].aave;
    };
    const withPositions = await get(A('2'));
    expect(withPositions.status).toBe('ok');
    expect(withPositions.positions).toHaveLength(2);
    expect(withPositions.positions.map((p: { symbol: string }) => p.symbol).sort()).toEqual(['DAI', 'USDC']);
    expect(withPositions.positions[0].observedAt).toBe('2026-01-01T00:00:00.000Z'); // fixture time, not now
    expect(await get(A('0'))).toEqual({ status: 'ok', positions: [] });
    expect(await get(A('a'))).toEqual({ status: 'unavailable', reason: 'unavailable' });
  });
  it('on: solana lookups never carry the section and solana providers are never asked for it', async () => {
    const s = await signer();
    let asked: boolean | undefined = true;
    const spySol = {
      name: 'spy-sol', simulated: true,
      async fetchWallets(addresses: string[], _sig: AbortSignal, opts?: { aave?: boolean }) {
        asked = opts?.aave;
        return {
          ok: true, provider: 'spy-sol', simulated: true, observedAt: NOW.toISOString(),
          wallets: addresses.map((a) => ({ address: a, assets: [], partial: false, warnings: [] })),
        };
      },
    };
    const r = await handleResolve(
      post({ network: 'solana', addresses: ['So11111111111111111111111111111111111111112'], currency: 'USD' }, await s.sign(good())),
      AAVE_ENV,
      deps(s.keys, { solanaProvider: spySol as never }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(asked).toBe(false);
    expect(body.wallets[0].aave).toBeUndefined();
  });
  it('live wording names the Aave coverage only when the flag is on, and the subtotal never includes it', async () => {
    const s = await signer();
    const liveStub = {
      name: 'stub-live', simulated: false,
      async fetchWallets(addresses: string[]) {
        return {
          ok: true, provider: 'stub-live', simulated: false, observedAt: NOW.toISOString(),
          wallets: addresses.map((a) => ({ address: a, assets: [], partial: false, warnings: [] })),
        };
      },
    };
    const envLive = (flag: boolean) => ({
      ...ENV,
      PORTFOLIO_LIVE_DATA: '1',
      ...(flag ? { PORTFOLIO_AAVE_V3: '1' } : {}),
    });
    const jwt = await s.sign(good());
    const on = await (await handleResolve(post(valid, jwt), envLive(true), deps(s.keys, { liveProvider: liveStub as never }))).json();
    expect(on.warnings[0]).toContain('Aave V3 shows supplied and variable-debt positions only');
    expect(on.warnings[0]).toContain('no stable debt, health factor or APY');
    expect(on.warnings[0]).toContain('other DeFi positions are not shown');
    expect(on.totals.note).toContain('never added to this subtotal');
    expect(on.totals.note).toContain('not total net worth');
    const off = await (await handleResolve(post(valid, jwt), envLive(false), deps(s.keys, { liveProvider: liveStub as never }))).json();
    expect(off.warnings[0]).toBe('Live read-only Ethereum data. Only ETH, USDC, USDT, DAI and WETH are checked; other tokens, NFTs and DeFi positions are not shown.');
    expect(off.totals.note).not.toContain('subtotal;');
  });
  it('health exposes the flag so the UI can hide the section when off', async () => {
    const s = await signer();
    const jwt = await s.sign(good());
    const get = (env: Env) => handleHealth(new Request('https://app.example/api/v1/health', { headers: { 'cf-access-jwt-assertion': jwt } }), env, deps(s.keys));
    expect((await (await get(ENV)).json()).aave).toBe(false);
    expect((await (await get(AAVE_ENV)).json()).aave).toBe(true);
    expect((await (await get({ ...ENV, PORTFOLIO_AAVE_V3: 'yes' })).json()).aave).toBe(false);
  });
  it('the strict browser parser rejects a malformed aave section instead of guessing', async () => {
    const s = await signer();
    const r = await handleResolve(
      post({ network: 'ethereum', addresses: [A('2')], currency: 'USD' }, await s.sign(good())),
      AAVE_ENV,
      deps(s.keys),
    );
    const body = await r.json();
    expect(parseApiSuccess(body)).not.toBeNull();
    const w0 = body.wallets[0];
    const bad: unknown[] = [
      { ...w0, aave: { status: 'bogus' } },
      { ...w0, aave: { status: 'ok' } }, // positions missing
      { ...w0, aave: { status: 'unavailable' } }, // reason missing
      { ...w0, aave: { status: 'unavailable', reason: 'exploded' } },
      { ...w0, aave: { status: 'ok', positions: [{ symbol: 'USDC' }] } },
      {
        ...w0,
        aave: {
          status: 'ok',
          positions: [{ ...w0.aave.positions[0], supplied: '1e999' }], // not a decimal string
        },
      },
      {
        ...w0,
        aave: {
          status: 'ok',
          positions: [{ ...w0.aave.positions[0], observedAt: 'not-a-date' }],
        },
      },
      {
        ...w0,
        aave: {
          status: 'ok',
          positions: [{ ...w0.aave.positions[0], underlyingAsset: '0x123' }],
        },
      },
    ];
    for (const w of bad) expect(parseApiSuccess({ ...body, wallets: [w] })).toBeNull();
  });
});
