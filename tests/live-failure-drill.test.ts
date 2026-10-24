import { describe, expect, it, vi } from 'vitest';
import { handleResolve, defaultDeps, type Deps, type Env } from '../server/portfolio/handler';
import { createLiveProvider, MAX_RESPONSE_BYTES } from '../server/portfolio/live-provider';

// Failure drill for the live path, in the shape the Pages Function runs: the real handler, the real
// live provider, and a mocked upstream. No network, no provider requests. Each case asserts the HTTP
// answer, that exactly ONE upstream request was made (no retry loop), that no balances were
// substituted, and that nothing private reaches the body or the log.
const TEAM = 'team-example.cloudflareaccess.com';
const AUD = 'aud123';
const ENV: Env = {
  PORTFOLIO_API_ENABLED: 'true',
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  PORTFOLIO_LIVE_DATA: '1',
};
const ADDR = '0x' + '1'.repeat(40);
const NOW = new Date('2026-10-23T12:00:00Z');
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
  const payload = {
    iss: `https://${TEAM}`,
    aud: [AUD],
    exp: Math.floor(NOW.getTime() / 1000) + 600,
  };
  const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = enc(payload);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    kp.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return {
    jwt: `${head}.${body}.${Buffer.from(sig).toString('base64url')}`,
    keys: [{ kid: 'k1', kty: 'RSA', n: jwk.n, e: jwk.e }],
  };
}

type Up = (init: RequestInit) => Promise<Response>;
async function lookup(up: Up, timeoutMs = 8000) {
  const s = await signer();
  let upstream = 0;
  const f = (async (_u: string, init: RequestInit) => {
    upstream++;
    return up(init);
  }) as unknown as typeof fetch;
  const d: Deps = {
    ...defaultDeps(),
    fetchKeys: async () => s.keys as never,
    now: () => NOW,
    id: () => 'req-drill',
    timeoutMs,
    liveProvider: createLiveProvider({ fetch: f, now: () => NOW, rpcUrl: 'https://rpc.example/' }),
  };
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const r = await handleResolve(
      new Request('https://app.example/api/v1/portfolio/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': s.jwt },
        body: JSON.stringify({ network: 'ethereum', addresses: [ADDR], currency: 'USD' }),
      }),
      ENV,
      d,
    );
    const text = await r.text();
    const logs = warn.mock.calls.map((c) => String(c[0])).join('\n');
    return { status: r.status, headers: r.headers, text, json: JSON.parse(text), upstream, logs };
  } finally {
    warn.mockRestore();
  }
}
const json =
  (o: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const CASES: [string, Up, number, string][] = [
  ['HTTP 429', json({ error: 'slow down 0xSECRET' }, 429), 429, 'rate_limited'],
  [
    'JSON-RPC rate-limit code',
    json({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'SECRETMSG' } }),
    429,
    'rate_limited',
  ],
  ['HTTP 500', json({ error: 'SECRETMSG' }, 500), 503, 'provider_unavailable'],
  ['HTTP 503', json({ error: 'SECRETMSG' }, 503), 503, 'provider_unavailable'],
  [
    'HTTP 302 (never followed)',
    async () =>
      new Response('', { status: 302, headers: { location: 'https://evil.example/SECRETURL' } }),
    503,
    'provider_unavailable',
  ],
  [
    'network error',
    async () => {
      throw new Error('ECONNRESET SECRETMSG');
    },
    503,
    'provider_unavailable',
  ],
  ['HTML 200', async () => new Response('<html>SECRETMSG</html>'), 502, 'provider_bad_response'],
  [
    'oversized body',
    async () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)),
    502,
    'provider_bad_response',
  ],
  [
    'JSON-RPC server error',
    json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'SECRETMSG' } }),
    503,
    'provider_unavailable',
  ],
  ['empty result', json({ jsonrpc: '2.0', id: 1, result: '0x' }), 502, 'provider_bad_response'],
  ['wrong id', json({ jsonrpc: '2.0', id: 2, result: '0x00' }), 502, 'provider_bad_response'],
];

describe('live failure drill (mocked upstream, handler level)', () => {
  for (const [name, up, status, code] of CASES) {
    it(`${name}: ${status} ${code}, one upstream request, no data, nothing private`, async () => {
      const r = await lookup(up);
      expect(r.status).toBe(status);
      expect(r.json.error.code).toBe(code);
      expect(r.upstream).toBe(1);
      expect(r.json.wallets).toBeUndefined();
      expect(r.json.totals).toBeUndefined();
      expect(r.headers.get('cache-control')).toContain('no-store');
      for (const secret of ['SECRET', ADDR.slice(2), 'rpc.example', 'evil.example']) {
        expect(r.text).not.toContain(secret);
        expect(r.logs).not.toContain(secret);
      }
      expect(r.logs).toContain('provider_failure');
      expect(r.logs).toContain('req-drill');
    });
  }
  it('a hung upstream that honours abort becomes 504 at the deadline, once', async () => {
    const r = await lookup(
      (init) =>
        new Promise<Response>((_, rej) =>
          init.signal?.addEventListener('abort', () => rej(new Error('aborted'))),
        ),
      40,
    );
    expect(r.status).toBe(504);
    expect(r.json.error.code).toBe('provider_timeout');
    expect(r.upstream).toBe(1);
  });
  it('an upstream that sends headers and then stalls the body becomes 504, not a hang', async () => {
    const r = await lookup(async (init) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"jsonrpc":'));
          init.signal?.addEventListener('abort', () => c.error(new Error('aborted')));
        },
      });
      return new Response(body, { status: 200 });
    }, 40);
    expect(r.status).toBe(504);
    expect(r.upstream).toBe(1);
  });
  it('an upstream that ignores abort entirely still gets a 504 at the deadline', async () => {
    const r = await lookup(() => new Promise<Response>(() => {}), 40);
    expect(r.status).toBe(504);
    expect(r.upstream).toBe(1);
  });
  it('a burst of 25 concurrent failing lookups makes exactly 25 upstream requests (no retries, no amplification)', async () => {
    const s = await signer();
    let upstream = 0;
    const f = (async () => {
      upstream++;
      return new Response('{}', { status: 429 });
    }) as unknown as typeof fetch;
    const d: Deps = {
      ...defaultDeps(),
      fetchKeys: async () => s.keys as never,
      now: () => NOW,
      id: () => 'req-burst',
      liveProvider: createLiveProvider({
        fetch: f,
        now: () => NOW,
        rpcUrl: 'https://rpc.example/',
      }),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rs = await Promise.all(
        Array.from({ length: 25 }, () =>
          handleResolve(
            new Request('https://app.example/api/v1/portfolio/resolve', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': s.jwt },
              body: JSON.stringify({ network: 'ethereum', addresses: [ADDR], currency: 'USD' }),
            }),
            ENV,
            d,
          ),
        ),
      );
      expect(rs.map((r) => r.status)).toEqual(Array(25).fill(429));
      expect(rs[0]!.headers.get('retry-after')).toBe('30');
      expect(upstream).toBe(25);
    } finally {
      warn.mockRestore();
    }
  });
  it('with the switch OFF the upstream is never contacted, even for a failing upstream', async () => {
    const s = await signer();
    let upstream = 0;
    const d: Deps = {
      ...defaultDeps(),
      fetchKeys: async () => s.keys as never,
      now: () => NOW,
      liveProvider: createLiveProvider({
        fetch: (async () => {
          upstream++;
          return new Response('{}', { status: 500 });
        }) as unknown as typeof fetch,
        now: () => NOW,
      }),
    };
    for (const live of [undefined, '', '0', 'true', ' 1']) {
      const r = await handleResolve(
        new Request('https://app.example/api/v1/portfolio/resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': s.jwt },
          body: JSON.stringify({ network: 'ethereum', addresses: [ADDR], currency: 'USD' }),
        }),
        { ...ENV, PORTFOLIO_LIVE_DATA: live },
        d,
      );
      expect(r.status).toBe(200);
      expect((await r.json()).simulated).toBe(true);
    }
    expect(upstream).toBe(0);
  });
});
