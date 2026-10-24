import { describe, expect, it } from 'vitest';
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
    [JSON.stringify({ ...valid, network: 'solana' }), 400, 'unsupported_network'],
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
    expect(Object.keys(h).sort()).toEqual(['mode', 'requestId', 'status']);
    const n = await (await handleNetworks(get('/api/v1/networks', jwt), ENV, d)).json();
    expect(n.networks).toEqual([{ id: 'ethereum', chainId: 1, status: 'mock' }]);
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
    const reqs = JSON.parse(String(init.body)) as { id: number; method: string }[];
    return new Response(
      JSON.stringify(
        reqs.map((r) => ({
          jsonrpc: '2.0',
          id: r.id,
          result:
            r.method === 'eth_blockNumber'
              ? '0x1312d00'
              : r.method === 'eth_getBalance'
                ? '0x' + (10n ** 18n).toString(16)
                : '0x' + '0'.repeat(64),
        })),
      ),
    );
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
