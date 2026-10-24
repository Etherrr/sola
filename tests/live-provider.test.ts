import { describe, expect, it } from 'vitest';
import {
  createLiveProvider,
  FEEDS,
  TOKENS,
  MAX_RESPONSE_BYTES,
} from '../server/portfolio/live-provider';

const NOW = new Date('2026-10-24T03:00:00.000Z');
const nowS = Math.floor(NOW.getTime() / 1000);
const ADDR = '0x' + 'ab'.repeat(20);
const hex = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');
const round = (answer: bigint, updated: number, id = 7n, started = updated - 10, air = 7n) =>
  '0x' +
  [id, answer, BigInt(started), BigInt(updated), air]
    .map((x) => x.toString(16).padStart(64, '0'))
    .join('');

type Cfg = {
  eth?: string | null;
  tokens?: Record<string, string | null>;
  feedAge?: Partial<Record<keyof typeof FEEDS, number>>;
  feedDec?: bigint;
  answer?: bigint;
  rawFeed?: (data: string, def: string) => string;
  rawBlock?: string;
  chainTs?: number;
  rpcError?: unknown;
};
const MC = '0xca11bde05977b3631167028862be2a173976ca11';
/** Test-side request decoder, independent of the production encoder's helpers. */
function decodeCalls(data: string): { target: string; data: string }[] {
  const b = data.slice(10);
  const word = (o: number) => BigInt('0x' + b.slice(o * 2, o * 2 + 64));
  const n = Number(word(0x20));
  const out: { target: string; data: string }[] = [];
  for (let i = 0; i < n; i++) {
    const el = 0x40 + Number(word(0x40 + i * 32));
    const target = '0x' + b.slice((el + 12) * 2, (el + 32) * 2);
    const len = Number(word(el + 0x60));
    out.push({ target, data: '0x' + b.slice((el + 0x80) * 2, (el + 0x80 + len) * 2) });
  }
  return out;
}
function encodeResults(rs: { success: boolean; data: string }[]): string {
  const w = (x: number) => x.toString(16).padStart(64, '0');
  const els = rs.map((r) => {
    const body = r.data.slice(2);
    return (
      w(r.success ? 1 : 0) +
      w(0x40) +
      w(body.length / 2) +
      body.padEnd(Math.ceil(body.length / 64) * 64, '0')
    );
  });
  let off = rs.length * 32;
  const offs = els.map((e) => {
    const o = off;
    off += e.length / 2;
    return w(o);
  });
  return '0x' + w(0x20) + w(rs.length) + offs.join('') + els.join('');
}
/** A fake JSON-RPC endpoint that answers one aggregate3 eth_call by target and call data. */
function rpc(cfg: Cfg = {}, status = 200, mutate?: (r: unknown) => unknown): typeof fetch {
  return (async (_u: string, init: RequestInit) => {
    const req = JSON.parse(String(init.body)) as {
      id: number;
      method: string;
      params: [{ to: string; data: string }, string];
    };
    if (cfg.rpcError !== undefined)
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: cfg.rpcError }), {
        status,
      });
    const results = decodeCalls(req.params[0].data).map((c) => {
      const ok = (data: string) => ({ success: true, data });
      const bad = { success: false, data: '0x' };
      if (c.target === MC) {
        if (c.data === '0x42cbb15c') return ok(cfg.rawBlock ?? hex(20_000_000n));
        if (c.data === '0x0f28c97d') return ok(hex(BigInt(cfg.chainTs ?? nowS)));
        if (cfg.eth === null) return bad;
        return ok(cfg.eth === undefined ? hex(10n ** 18n) : cfg.eth);
      }
      const feed = (Object.keys(FEEDS) as (keyof typeof FEEDS)[]).find(
        (f) => FEEDS[f].address.toLowerCase() === c.target.toLowerCase(),
      );
      if (feed) {
        const def =
          c.data === '0x313ce567'
            ? hex(cfg.feedDec ?? 8n)
            : round(cfg.answer ?? 100_000_000n, nowS - (cfg.feedAge?.[feed] ?? 60));
        return ok(cfg.rawFeed ? cfg.rawFeed(c.data, def) : def);
      }
      const tok = TOKENS.find((t) => t.address === c.target.toLowerCase())!;
      const v = cfg.tokens?.[tok.symbol];
      return v === null ? bad : ok(v === undefined ? hex(0n) : v);
    });
    const obj = { jsonrpc: '2.0', id: req.id, result: encodeResults(results) };
    return new Response(JSON.stringify(mutate ? mutate(obj) : obj), { status });
  }) as unknown as typeof fetch;
}
const run = (f: typeof fetch, signal = new AbortController().signal) =>
  createLiveProvider({ fetch: f, now: () => NOW }).fetchWallets([ADDR], signal);

const ethPrice = async (cfg: Cfg) => {
  const r = await run(rpc(cfg));
  if (!r.ok) throw new Error('x');
  return r.wallets[0]!.assets[0]!.price;
};
describe('per-feed freshness follows each configured heartbeat', () => {
  const G = 15 * 60;
  const price = async (symbol: string, feed: keyof typeof FEEDS, age: number) => {
    const r = await run(
      rpc({
        tokens: { USDC: hex(1_000_000n), USDT: hex(1_000_000n), DAI: hex(10n ** 18n) },
        feedAge: { [feed]: age },
      }),
    );
    if (!r.ok) throw new Error('x');
    return r.wallets[0]!.assets.find((a) => a.symbol === symbol)!.price;
  };
  it('configured heartbeats', () => {
    expect(
      [FEEDS['ETH/USD'], FEEDS['DAI/USD'], FEEDS['USDC/USD'], FEEDS['USDT/USD']].map(
        (f) => f.heartbeatS,
      ),
    ).toEqual([3600, 3600, 82800, 86400]);
  });
  it('DAI is Unknown just past 1 h + grace and priced just inside it', async () => {
    expect(await price('DAI', 'DAI/USD', 3600 + G + 1)).toBeNull();
    expect(await price('DAI', 'DAI/USD', 3600 + G - 5)).toBe('1');
    expect(await price('DAI', 'DAI/USD', 24 * 3600)).toBeNull();
  });
  it('ETH is Unknown just past 1 h + grace', async () => {
    expect(await ethPrice({ feedAge: { 'ETH/USD': 3600 + G + 1 } })).toBeNull();
    expect(await ethPrice({ feedAge: { 'ETH/USD': 3600 + G - 5 } })).toBe('1');
  });
  it('USDC (23 h) and USDT (24 h) use their own limits', async () => {
    expect(await price('USDC', 'USDC/USD', 82800 + G - 5)).toBe('1');
    expect(await price('USDC', 'USDC/USD', 82800 + G + 1)).toBeNull();
    expect(await price('USDT', 'USDT/USD', 86400 + G - 5)).toBe('1');
    expect(await price('USDT', 'USDT/USD', 86400 + G + 1)).toBeNull();
  });
});
describe('live provider hardening (reviewer findings)', () => {
  it('a bare 0x from the feed or the balance is not a value and does not throw', async () => {
    expect(await ethPrice({ rawFeed: () => '0x' })).toBeNull();
    const r = await run(rpc({ eth: '0x' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.wallets[0]!.partial).toBe(true);
  });
  it('rejects short or long ABI words for decimals and latestRoundData', async () => {
    expect(
      await ethPrice({ rawFeed: (d, def) => (d === '0x313ce567' ? def + '00' : def) }),
    ).toBeNull();
    expect(
      await ethPrice({ rawFeed: (d, def) => (d === '0xfeaf968c' ? def.slice(0, -64) : def) }),
    ).toBeNull();
    expect(
      await ethPrice({ rawFeed: (d, def) => (d === '0xfeaf968c' ? def + '0'.repeat(64) : def) }),
    ).toBeNull();
  });
  it('rejects roundId 0, startedAt 0 or after updatedAt; does not use answeredInRound', async () => {
    const mk = (id: bigint, st: number, air: bigint) => ({
      rawFeed: (d: string, def: string) =>
        d === '0xfeaf968c' ? round(100_000_000n, nowS - 60, id, st, air) : def,
    });
    expect(await ethPrice(mk(0n, nowS - 70, 7n))).toBeNull();
    expect(await ethPrice(mk(7n, 0, 7n))).toBeNull();
    expect(await ethPrice(mk(7n, nowS - 30, 7n))).toBeNull();
    // answeredInRound is documented deprecated by Chainlink, so a mismatch alone does not reject.
    expect(await ethPrice(mk(7n, nowS - 70, 3n))).toBe('1');
  });
  it('rejects a feed timestamp more than 30 s in the future', async () => {
    expect(await ethPrice({ feedAge: { 'ETH/USD': -240 } })).toBeNull();
    expect(await ethPrice({ feedAge: { 'ETH/USD': -10 } })).toBe('1');
  });
  it('reads everything in ONE eth_call at latest, with block number and time from inside the call', async () => {
    const seen: { method: string; tag: unknown; isArray: boolean }[] = [];
    const inner = rpc({});
    const f = (async (u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push({ method: body.method, tag: body.params[1], isArray: Array.isArray(body) });
      return inner(u, init);
    }) as unknown as typeof fetch;
    const r = await run(f);
    if (!r.ok) throw new Error('x');
    expect(seen).toEqual([{ method: 'eth_call', tag: 'latest', isArray: false }]);
    expect(r.wallets[0]!.warnings.join()).toMatch(/block 20000000/);
  });
  it('the maximum 5 addresses stay within 1 subrequest and a 35-call aggregate', async () => {
    let reqs = 0;
    let calls = 0;
    const inner = rpc({});
    const f = (async (u: string, init: RequestInit) => {
      reqs += 1;
      calls = decodeCalls(JSON.parse(String(init.body)).params[0].data).length;
      return inner(u, init);
    }) as unknown as typeof fetch;
    const addrs = [1, 2, 3, 4, 5].map((n) => '0x' + String(n).repeat(40));
    const r = await createLiveProvider({ fetch: f, now: () => NOW }).fetchWallets(
      addrs,
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    expect(reqs).toBe(1);
    expect(calls).toBe(2 + 5 * 5 + 8);
  });
  it('a node whose latest block is far from this clock is refused, not trusted for feed age', async () => {
    const r = await run(rpc({ chainTs: nowS - 600 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diag?.step).toBe('stale_node');
    expect((await run(rpc({ chainTs: nowS - 100 }))).ok).toBe(true);
  });
  it('a bad block number is a bad_response, not a throw', async () => {
    for (const rawBlock of ['0x', hex(0n), '0x' + 'f'.repeat(64)]) {
      const r = await run(rpc({ rawBlock }));
      expect(r.ok).toBe(false);
    }
  });
});
describe('live provider (default-off, read-only)', () => {
  it('reads ETH and listed tokens, prices from fresh feeds, omits zero balances', async () => {
    const r = await run(
      rpc({ eth: hex(1_500_000_000_000_000_000n), tokens: { USDC: hex(2_500_000n) } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.simulated).toBe(false);
    const a = r.wallets[0]!.assets;
    expect(a.map((x) => x.assetId)).toEqual([
      'eip155:1/native',
      'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    ]);
    expect(a[0]).toMatchObject({
      amount: '1.5',
      price: '1',
      value: '1.5',
      priceSource: 'chainlink:ETH/USD',
    });
    expect(a[1]).toMatchObject({ amount: '2.5', value: '2.5' });
    expect(r.wallets[0]!.partial).toBe(false);
  });
  it('a stale feed makes the price Unknown, never a stale price shown as fresh', async () => {
    const r = await run(rpc({ feedAge: { 'ETH/USD': 3 * 3600 } }));
    if (!r.ok) throw new Error('x');
    const eth = r.wallets[0]!.assets[0]!;
    expect(eth.price).toBeNull();
    expect(eth.value).toBeNull();
    expect(r.wallets[0]!.warnings.join()).toMatch(/Unknown, not zero/);
  });
  it.each([
    ['wrong feed decimals', { feedDec: 18n }],
    ['zero answer', { answer: 0n }],
    ['negative answer', { answer: (1n << 256n) - 5n }],
  ])('rejects the price for %s', async (_n, cfg) => {
    const r = await run(rpc(cfg as Cfg));
    if (!r.ok) throw new Error('x');
    expect(r.wallets[0]!.assets[0]!.price).toBeNull();
  });
  it('a failed token read is partial with a warning, not a zero balance', async () => {
    const r = await run(rpc({ tokens: { DAI: null } }));
    if (!r.ok) throw new Error('x');
    expect(r.wallets[0]!.partial).toBe(true);
    expect(r.wallets[0]!.warnings.join()).toMatch(/DAI balance could not be read/);
  });
  it('a failed ETH read is partial too', async () => {
    const r = await run(rpc({ eth: null }));
    if (!r.ok) throw new Error('x');
    expect(r.wallets[0]!.partial).toBe(true);
  });
  it('maps HTTP 429, 5xx, bad JSON, oversized, malformed results and RPC errors to explicit errors', async () => {
    const kind = async (f: typeof fetch) => {
      const r = await run(f);
      return r.ok ? 'ok' : r.kind;
    };
    expect(await kind(rpc({}, 429))).toBe('rate_limited');
    expect(await kind(rpc({}, 503))).toBe('unavailable');
    expect(await kind(rpc({}, 302))).toBe('unavailable');
    expect(await kind((async () => new Response('nope')) as unknown as typeof fetch)).toBe(
      'bad_response',
    );
    expect(
      await kind(
        (async () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1))) as unknown as typeof fetch,
      ),
    ).toBe('bad_response');
    expect(await kind(rpc({}, 200, () => [{ result: '0x' }]))).toBe('bad_response');
    expect(await kind(rpc({}, 200, () => ({ result: 1 })))).toBe('bad_response');
    expect(await kind(rpc({}, 200, (o) => ({ ...(o as object), result: '0x' })))).toBe(
      'bad_response',
    );
    expect(await kind(rpc({ rpcError: { code: -32005 } }))).toBe('rate_limited');
    expect(await kind(rpc({ rpcError: { code: -32000 } }))).toBe('unavailable');
    expect(
      await kind((async () => {
        throw new Error('net');
      }) as unknown as typeof fetch),
    ).toBe('unavailable');
  });
  it('an aborted request is a timeout', async () => {
    const c = new AbortController();
    c.abort();
    const f = (async () => {
      throw new Error('aborted');
    }) as unknown as typeof fetch;
    const r = await run(f, c.signal);
    expect(r.ok ? 'ok' : r.kind).toBe('timeout');
  });
  it('never follows redirects (a 3xx is unavailable) and sends only a JSON-RPC body to the configured endpoint', async () => {
    let seen: RequestInit | undefined;
    let url = '';
    const f = (async (u: string, init: RequestInit) => {
      url = u;
      seen = init;
      return rpc()(u, init);
    }) as unknown as typeof fetch;
    await createLiveProvider({
      fetch: f,
      now: () => NOW,
      rpcUrl: 'https://rpc.example/',
    }).fetchWallets([ADDR], new AbortController().signal);
    expect(url).toBe('https://rpc.example/');
    expect(seen?.redirect).toBe('manual'); // workerd rejects 'error'; a 3xx is not ok, so it is unavailable
    expect(seen?.method).toBe('POST');
    expect(Object.keys(seen?.headers as object)).toEqual(['content-type']);
  });
});

describe('failure diagnostics are sanitized', () => {
  it('carry only a fixed step, bounded numbers and the call count', async () => {
    const r1 = await run(rpc({}, 429));
    const r2 = await run(
      rpc({ rpcError: { code: -32005, message: `limit for ${ADDR} at https://x.example/key123` } }),
    );
    const r3 = await run(rpc({}, 200, (o) => ({ ...(o as object), result: '0x1234' })));
    for (const r of [r1, r2, r3]) expect(r.ok).toBe(false);
    if (r1.ok || r2.ok || r3.ok) return;
    expect(r1.diag).toEqual({ step: 'response', http: 429, calls: 35 - 25 + 5 });
    expect(r2.diag).toEqual({ step: 'rpc_error', http: 200, rpcCode: -32005, calls: 15 });
    expect(r3.diag).toEqual({ step: 'decode', http: 200, calls: 15 });
    const all = JSON.stringify([r1, r2, r3]);
    expect(all).not.toContain(ADDR.slice(2));
    expect(all).not.toContain('key123');
    expect(all).not.toContain('x.example');
  });
  it('a non-integer or absent RPC code adds no code field', async () => {
    const r = await run(rpc({ rpcError: { code: 'boom', message: 'x' } }));
    if (r.ok) throw new Error('x');
    expect(r.diag).toEqual({ step: 'rpc_error', http: 200, calls: 15 });
  });
});
