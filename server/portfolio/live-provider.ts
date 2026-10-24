import { formatUnits, valueUsd } from './units';
import type { Asset, WalletResult } from './contract';
import type { PortfolioProvider, ProviderResult } from './provider';

// DEFAULT-OFF live read-only Ethereum provider. It reads balances over a public JSON-RPC endpoint
// and prices from Chainlink USD feeds read through the same endpoint (no second vendor, no key).
// Only the tokens listed below are looked up: a wallet's other tokens are NOT shown.
export const RPC_URL = 'https://ethereum-rpc.publicnode.com';
export const MAX_RESPONSE_BYTES = 64 * 1024;
const FEED_DECIMALS = 8;
const MAX_FUTURE_S = 30;

type FeedId = 'ETH/USD' | 'USDC/USD' | 'USDT/USD' | 'DAI/USD';
// Feed addresses and descriptions were read on-chain on 2026-10-23 (description() matched). Max ages
// follow each feed's heartbeat with margin: ETH/USD 1 h, the stablecoin feeds 24 h.
export const FEEDS: Record<FeedId, { address: string; maxAgeS: number }> = {
  'ETH/USD': { address: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', maxAgeS: 2 * 3600 },
  'USDC/USD': { address: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6', maxAgeS: 25 * 3600 },
  'USDT/USD': { address: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D', maxAgeS: 25 * 3600 },
  'DAI/USD': { address: '0xAed0c38402a5d19df6E4c03F4E2DcEd6e29c1ee9', maxAgeS: 25 * 3600 },
};
// symbol() and decimals() of each contract were read on-chain on 2026-10-23.
export const TOKENS: { symbol: string; address: string; decimals: number; feed: FeedId }[] = [
  {
    symbol: 'USDC',
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
    feed: 'USDC/USD',
  },
  {
    symbol: 'USDT',
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    decimals: 6,
    feed: 'USDT/USD',
  },
  {
    symbol: 'DAI',
    address: '0x6b175474e89094c44da98b954eedeac495271d0f',
    decimals: 18,
    feed: 'DAI/USD',
  },
  // Wrapped ether is priced with the ETH/USD feed (a 1:1 wrapper; a depeg would not show).
  {
    symbol: 'WETH',
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    decimals: 18,
    feed: 'ETH/USD',
  },
];

const HEX = /^0x[0-9a-fA-F]+$/; // a bare "0x" is not a value
type Rpc = { id: number; result?: unknown; error?: unknown };
const word = (hex: string, i: number) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const pad = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');

async function readCapped(res: Response, limit: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return new TextDecoder().decode(all);
}

export type LiveDeps = { fetch: typeof fetch; now: () => Date; rpcUrl: string };

export function createLiveProvider(over: Partial<LiveDeps> = {}): PortfolioProvider {
  const d: LiveDeps = {
    fetch: (...a) => fetch(...a),
    now: () => new Date(),
    rpcUrl: RPC_URL,
    ...over,
  };
  return {
    name: 'publicnode-rpc+chainlink',
    simulated: false,
    async fetchWallets(addresses, signal): Promise<ProviderResult> {
      const fail = (kind: 'rate_limited' | 'timeout' | 'unavailable' | 'bad_response') =>
        ({ ok: false, provider: 'publicnode-rpc+chainlink', kind }) as const;
      type Call = { method: string; params: unknown[] };
      const rpc = async (
        batch: Call[],
      ): Promise<
        { ok: true; out: Map<number, string | null> } | { ok: false; r: ReturnType<typeof fail> }
      > => {
        let res: Response;
        try {
          res = await d.fetch(d.rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              batch.map((c, id) => ({ jsonrpc: '2.0', id, method: c.method, params: c.params })),
            ),
            signal,
            redirect: 'manual',
          });
        } catch {
          return { ok: false, r: fail(signal.aborted ? 'timeout' : 'unavailable') };
        }
        if (res.status === 429) return { ok: false, r: fail('rate_limited') };
        if (!res.ok) return { ok: false, r: fail('unavailable') };
        let text: string | null;
        try {
          text = await readCapped(res, MAX_RESPONSE_BYTES);
        } catch {
          return { ok: false, r: fail(signal.aborted ? 'timeout' : 'unavailable') };
        }
        if (text === null) return { ok: false, r: fail('bad_response') };
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return { ok: false, r: fail('bad_response') };
        }
        if (!Array.isArray(parsed) || parsed.length > batch.length)
          return { ok: false, r: fail('bad_response') };
        const o = new Map<number, string | null>();
        for (const r of parsed as Rpc[]) {
          if (typeof r !== 'object' || r === null || !Number.isInteger(r.id))
            return { ok: false, r: fail('bad_response') };
          const id = r.id;
          if (id < 0 || id >= batch.length || o.has(id))
            return { ok: false, r: fail('bad_response') };
          o.set(id, typeof r.result === 'string' && HEX.test(r.result) ? r.result : null);
        }
        return { ok: true, out: o };
      };
      // Step 1: pin one block so every balance and feed read in step 2 comes from the same state.
      const head = await rpc([{ method: 'eth_blockNumber', params: [] }]);
      if (!head.ok) return head.r;
      const bn = head.out.get(0);
      if (!bn || bn.length > 18 || BigInt(bn) === 0n) return fail('bad_response');
      const BLOCK = '0x' + BigInt(bn).toString(16);
      const blockNumber = BigInt(bn).toString();
      // One batch: per address ETH balance and each token balance, then each feed's decimals and latest round.
      const calls: Call[] = [];
      const plan: { addr: number; token: number | null; idx: number }[] = [];
      addresses.forEach((a, ai) => {
        plan.push({ addr: ai, token: null, idx: calls.length });
        calls.push({ method: 'eth_getBalance', params: [a.toLowerCase(), BLOCK] });
        TOKENS.forEach((t, ti) => {
          plan.push({ addr: ai, token: ti, idx: calls.length });
          calls.push({
            method: 'eth_call',
            params: [{ to: t.address, data: '0x70a08231' + pad(a) }, BLOCK],
          });
        });
      });
      const feedIds = Object.keys(FEEDS) as FeedId[];
      const feedAt = new Map<FeedId, { dec: number; round: number }>();
      for (const f of feedIds) {
        feedAt.set(f, { dec: calls.length, round: calls.length + 1 });
        calls.push({
          method: 'eth_call',
          params: [{ to: FEEDS[f].address, data: '0x313ce567' }, BLOCK],
        });
        calls.push({
          method: 'eth_call',
          params: [{ to: FEEDS[f].address, data: '0xfeaf968c' }, BLOCK],
        });
      }
      const body = await rpc(calls);
      if (!body.ok) return body.r;
      const out = body.out;
      const nowS = Math.floor(d.now().getTime() / 1000);
      // Prices: valid only when decimals are 8, the answer is positive and the round is fresh.
      const prices = new Map<FeedId, { price: string; at: string }>();
      for (const f of feedIds) {
        const at = feedAt.get(f)!;
        const dec = out.get(at.dec);
        const round = out.get(at.round);
        // Exact ABI shapes only: decimals() is one 32-byte word, latestRoundData() is five.
        if (!dec || dec.length !== 66 || !round || round.length !== 2 + 5 * 64) continue;
        if (BigInt(dec) !== BigInt(FEED_DECIMALS)) continue;
        // answeredInRound (word 4) is documented by Chainlink as deprecated, so it is not used.
        const roundId = BigInt('0x' + word(round, 0));
        const answer = BigInt('0x' + word(round, 1));
        const started = BigInt('0x' + word(round, 2));
        const updatedBig = BigInt('0x' + word(round, 3));
        if (roundId === 0n || started === 0n || updatedBig === 0n || started > updatedBig) continue;
        if (answer <= 0n || answer >= 1n << 255n) continue;
        if (updatedBig > BigInt(Number.MAX_SAFE_INTEGER)) continue;
        const updated = Number(updatedBig);
        if (nowS - updated > FEEDS[f].maxAgeS || updated - nowS > MAX_FUTURE_S) continue;
        prices.set(f, {
          price: formatUnits(answer, FEED_DECIMALS),
          at: new Date(updated * 1000).toISOString(),
        });
      }
      const wallets: WalletResult[] = addresses.map((address) => ({
        address,
        assets: [],
        partial: false,
        warnings: [],
      }));
      const mk = (
        symbol: string,
        id: string,
        decimals: number,
        raw: bigint,
        feed: FeedId,
      ): Asset => {
        const p = prices.get(feed);
        return {
          assetId: id,
          symbol,
          decimals,
          rawAmount: raw.toString(),
          amount: formatUnits(raw, decimals),
          price: p ? p.price : null,
          value: p ? valueUsd(raw, decimals, p.price) : null,
          priceSource: p ? `chainlink:${feed}` : null,
          priceObservedAt: p ? p.at : null,
        };
      };
      for (const p of plan) {
        const w = wallets[p.addr]!;
        const hex = out.get(p.idx);
        const t = p.token === null ? null : TOKENS[p.token]!;
        const label = t ? t.symbol : 'ETH';
        const badLen = t ? hex?.length !== 66 : !hex || hex.length < 3 || hex.length > 66;
        if (hex === null || hex === undefined || badLen) {
          w.partial = true;
          if (
            !w.warnings.includes(`${label} balance could not be read; this is not a zero balance.`)
          )
            w.warnings.push(`${label} balance could not be read; this is not a zero balance.`);
          continue;
        }
        const raw = BigInt(hex);
        if (raw === 0n) continue;
        w.assets.push(
          t
            ? mk(t.symbol, `eip155:1/erc20:${t.address}`, t.decimals, raw, t.feed)
            : mk('ETH', 'eip155:1/native', 18, raw, 'ETH/USD'),
        );
      }
      for (const w of wallets) {
        w.warnings.push(`Balances and prices were read together at Ethereum block ${blockNumber}.`);
      }
      for (const w of wallets)
        if (w.assets.some((a) => a.price === null))
          w.warnings.push(
            'Some prices are unavailable or stale; those values are Unknown, not zero.',
          );
      return {
        ok: true,
        provider: 'publicnode-rpc+chainlink',
        simulated: false,
        observedAt: d.now().toISOString(),
        wallets,
      };
    },
  };
}
