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
};
/** A fake JSON-RPC endpoint answering by method and call data. */
function rpc(cfg: Cfg = {}, status = 200, mutate?: (r: unknown) => unknown): typeof fetch {
  return (async (_u: string, init: RequestInit) => {
    const reqs = JSON.parse(String(init.body)) as {
      id: number;
      method: string;
      params: [unknown, ...unknown[]];
    }[];
    const out = reqs.map((r) => {
      let result: string | null;
      if (r.method === 'eth_blockNumber') result = cfg.rawBlock ?? '0x1312d00';
      else if (r.method === 'eth_getBalance')
        result = cfg.eth === undefined ? hex(10n ** 18n) : cfg.eth;
      else {
        const p = r.params[0] as { to: string; data: string };
        const feed = (Object.keys(FEEDS) as (keyof typeof FEEDS)[]).find(
          (f) => FEEDS[f].address.toLowerCase() === p.to.toLowerCase(),
        );
        if (feed) {
          const def =
            p.data === '0x313ce567'
              ? hex(cfg.feedDec ?? 8n)
              : round(cfg.answer ?? 100_000_000n, nowS - (cfg.feedAge?.[feed] ?? 60));
          result = cfg.rawFeed ? cfg.rawFeed(p.data, def) : def;
        } else {
          const tok = TOKENS.find((t) => t.address === p.to.toLowerCase())!;
          const v = cfg.tokens?.[tok.symbol];
          result = v === undefined ? hex(0n) : v;
        }
      }
      return result === null
        ? { jsonrpc: '2.0', id: r.id, error: { code: -1 } }
        : { jsonrpc: '2.0', id: r.id, result };
    });
    const body = JSON.stringify(mutate && reqs.length > 1 ? mutate(out) : out);
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}
const run = (f: typeof fetch, signal = new AbortController().signal) =>
  createLiveProvider({ fetch: f, now: () => NOW }).fetchWallets([ADDR], signal);

const ethPrice = async (cfg: Cfg) => {
  const r = await run(rpc(cfg));
  if (!r.ok) throw new Error('x');
  return r.wallets[0]!.assets[0]!.price;
};
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
  it('pins one block for the whole batch and reports it', async () => {
    const tags: unknown[] = [];
    const inner = rpc({});
    const f = (async (u: string, init: RequestInit) => {
      for (const c of JSON.parse(String(init.body)) as { method: string; params: unknown[] }[])
        if (c.method !== 'eth_blockNumber') tags.push(c.params[1]);
      return inner(u, init);
    }) as unknown as typeof fetch;
    const r = await run(f);
    if (!r.ok) throw new Error('x');
    expect(new Set(tags)).toEqual(new Set(['0x1312d00']));
    expect(r.wallets[0]!.warnings.join()).toMatch(/block 20000000/);
  });
  it('the maximum 5 addresses stay within 2 subrequests and a 33-call batch', async () => {
    let reqs = 0;
    let biggest = 0;
    const inner = rpc({});
    const f = (async (u: string, init: RequestInit) => {
      reqs += 1;
      biggest = Math.max(biggest, (JSON.parse(String(init.body)) as unknown[]).length);
      return inner(u, init);
    }) as unknown as typeof fetch;
    const addrs = [1, 2, 3, 4, 5].map((n) => '0x' + String(n).repeat(40));
    const r = await createLiveProvider({ fetch: f, now: () => NOW }).fetchWallets(
      addrs,
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    expect(reqs).toBe(2);
    expect(biggest).toBe(5 * 5 + 8);
  });
  it('a bad block number is a bad_response, not a throw', async () => {
    for (const rawBlock of ['0x', '0x0', '0x' + 'f'.repeat(20)]) {
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
  it('maps HTTP 429, 5xx, bad JSON, oversized, duplicate ids and non-arrays to explicit errors', async () => {
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
    expect(
      await kind(rpc({}, 200, (o) => (o as { id: number }[]).map((x) => ({ ...x, id: 0 })))),
    ).toBe('bad_response');
    expect(await kind(rpc({}, 200, () => ({ result: 1 })))).toBe('bad_response');
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
