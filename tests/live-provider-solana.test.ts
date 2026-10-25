import { describe, expect, it } from 'vitest';
import { createSolanaLiveProvider, SOL_USD_FEED } from '../server/portfolio/live-provider-solana';

const NOW = new Date('2026-10-24T03:00:00.000Z');
const nowS = Math.floor(NOW.getTime() / 1000);
const ADDR = 'So11111111111111111111111111111111111111112';
const hex = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');
const round = (answer: bigint, updated: number, id = 7n, started = updated - 10) =>
  '0x' +
  [id, answer, BigInt(started), BigInt(updated), id]
    .map((x) => x.toString(16).padStart(64, '0'))
    .join('');

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

type Cfg = {
  lamports?: number;
  feedAgeS?: number;
  answer?: bigint;
  chainTs?: number;
  solanaError?: { code: number; message: string };
  solanaStatus?: number;
  solanaBody?: unknown;
  ethStatus?: number;
};
/** Fake fetch routing by URL: first the Ethereum multicall (block/time/feed), then the Solana batch. */
function rpc(cfg: Cfg = {}): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    if (url.includes('ethereum')) {
      if (cfg.ethStatus && cfg.ethStatus !== 200)
        return new Response('x', { status: cfg.ethStatus });
      const results = [
        { success: true, data: hex(20_000_000n) },
        { success: true, data: hex(BigInt(cfg.chainTs ?? nowS)) },
        { success: true, data: hex(8n) },
        { success: true, data: round(cfg.answer ?? 20_000_000_000n, nowS - (cfg.feedAgeS ?? 60)) },
      ];
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: encodeResults(results) }),
        { status: 200 },
      );
    }
    if (cfg.solanaStatus && cfg.solanaStatus !== 200)
      return new Response('x', { status: cfg.solanaStatus });
    if (cfg.solanaBody !== undefined)
      return new Response(JSON.stringify(cfg.solanaBody), { status: 200 });
    const req = JSON.parse(String(init.body)) as { id: number }[];
    const items = req.map((r) =>
      cfg.solanaError
        ? { jsonrpc: '2.0', id: r.id, error: cfg.solanaError }
        : {
            jsonrpc: '2.0',
            id: r.id,
            result: { context: { slot: 460_974_972 }, value: cfg.lamports ?? 2_000_000_000 },
          },
    );
    return new Response(JSON.stringify(items), { status: 200 });
  }) as unknown as typeof fetch;
}

const run = (f: typeof fetch, addrs = [ADDR]) =>
  createSolanaLiveProvider({ fetch: f, now: () => NOW }).fetchWallets(
    addrs,
    new AbortController().signal,
  );

describe('solana live provider', () => {
  it('reads the SOL balance and prices it with the Chainlink SOL/USD feed', async () => {
    const r = await run(rpc());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provider).toBe('publicnode-solana+chainlink');
    const a = r.wallets[0]!.assets[0]!;
    expect(a.symbol).toBe('SOL');
    expect(a.amount).toBe('2');
    expect(a.price).toBe('200');
    expect(a.value).toBe('400');
    expect(a.priceSource).toBe('chainlink:SOL/USD');
    expect(r.wallets[0]!.partial).toBe(false);
    expect(r.wallets[0]!.warnings.join(' ')).toContain('460974972');
  });

  it('shows the balance without a price when the feed round is stale (24h heartbeat)', async () => {
    const r = await run(rpc({ feedAgeS: SOL_USD_FEED.maxAgeS + 1 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.wallets[0]!.assets[0]!;
    expect(a.price).toBeNull();
    expect(a.value).toBeNull();
    expect(r.wallets[0]!.warnings.join(' ')).toContain('price');
  });

  it('accepts a price exactly at the staleness boundary', async () => {
    const r = await run(rpc({ feedAgeS: SOL_USD_FEED.maxAgeS }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wallets[0]!.assets[0]!.price).toBe('200');
  });

  it('marks a wallet partial when its getBalance item errors; other wallets still report', async () => {
    const second = 'So11111111111111111111111111111111111111113';
    const f = (async (url: string, init: RequestInit) => {
      if (url.includes('ethereum')) return rpc()(url, init);
      const req = JSON.parse(String(init.body)) as { id: number; params: string[] }[];
      const items = req.map((r) =>
        r.id === 1
          ? { jsonrpc: '2.0', id: r.id, error: { code: -32602, message: 'x' } }
          : {
              jsonrpc: '2.0',
              id: r.id,
              result: { context: { slot: 460_974_972 }, value: 5_000_000_000 },
            },
      );
      return new Response(JSON.stringify(items), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await run(f, [ADDR, second]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wallets[0]!.partial).toBe(true);
    expect(r.wallets[0]!.warnings.join(' ')).toContain('not a zero balance');
    expect(r.wallets[1]!.assets[0]!.amount).toBe('5');
  });

  it('maps Solana HTTP 429 to rate_limited and never substitutes data', async () => {
    const r = await run(rpc({ solanaStatus: 429 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('rate_limited');
  });

  it('fails when the Ethereum node clock is too far from ours', async () => {
    const r = await run(rpc({ chainTs: nowS - 3600 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('bad_response');
    expect(r.diag?.step).toBe('stale_node');
  });

  it('fails on a malformed Solana response body', async () => {
    const r = await run(rpc({ solanaBody: { not: 'an array' } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('bad_response');
  });

  it('treats an unsafe-integer lamport value as unread, never as zero', async () => {
    const r = await run(
      rpc({
        solanaBody: [
          {
            jsonrpc: '2.0',
            id: 1,
            result: { context: { slot: 1 }, value: Number.MAX_SAFE_INTEGER + 1.5 },
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wallets[0]!.partial).toBe(true);
    expect(r.wallets[0]!.assets.length).toBe(0);
  });

  it('reports a zero SOL balance as empty with no assets, not an error', async () => {
    const r = await run(rpc({ lamports: 0 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wallets[0]!.assets.length).toBe(0);
    expect(r.wallets[0]!.partial).toBe(false);
  });
});

it('timestamps the SOL balance response independently of the Ethereum pricing block', async () => {
  let receivedSolana = false;
  const original = rpc({ chainTs: nowS - 30 });
  const balanceReceipt = new Date(NOW.getTime() + 2000);
  const result = await createSolanaLiveProvider({
    fetch: (async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args);
      if (String(args[0]).includes('solana')) receivedSolana = true;
      return response;
    }) as typeof fetch,
    now: () => (receivedSolana ? balanceReceipt : NOW),
  }).fetchWallets([ADDR], new AbortController().signal);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.observedAt).toBe(balanceReceipt.toISOString());
  expect(result.wallets[0]!.assets[0]!.priceObservedAt).toBe(
    new Date((nowS - 60) * 1000).toISOString(),
  );
});
