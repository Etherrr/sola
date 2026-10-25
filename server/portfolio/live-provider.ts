import { formatUnits, valueUsd } from './units';
import { SUPPORTED_EVM_TOKENS } from '../../lib/supported-evm-tokens';
import type { AavePositionView, Asset, WalletResult } from './contract';
import type { Diag, FetchOptions, PortfolioProvider, ProviderResult } from './provider';
import {
  readAaveV3PositionsForUsers,
  type AavePosition,
  type RpcCall,
  type RpcFailure,
} from './aave-v3-read';
import {
  addressWord,
  decodeAggregate3,
  encodeAggregate3,
  SEL_BALANCE_OF,
  SEL_DECIMALS,
  SEL_GET_BLOCK_NUMBER,
  SEL_GET_CURRENT_BLOCK_TIMESTAMP,
  SEL_GET_ETH_BALANCE,
  SEL_LATEST_ROUND_DATA,
  type Call3,
} from './abi';

// DEFAULT-OFF live read-only Ethereum provider. It reads balances over a public JSON-RPC endpoint
// and prices from Chainlink USD feeds read through the same endpoint (no second vendor, no key).
// Only the tokens listed below are looked up: a wallet's other tokens are NOT shown.
export const RPC_URL = 'https://ethereum-rpc.publicnode.com';
export const MAX_RESPONSE_BYTES = 64 * 1024;
export const FEED_DECIMALS = 8;
export const MAX_FUTURE_S = 30;
export const MAX_CLOCK_SKEW_S = 120;
// Multicall3, canonical address per https://github.com/mds1/multicall3 (read 23 Oct 2026).
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

// Aave V3 on Ethereum mainnet (bgd-labs/aave-address-book; deployed source verified via
// Sourcify's address-scoped lookup, 25 Oct 2026 - see docs/AAVE_V3_POSITIONS.md).
export const AAVE_UI_POOL_DATA_PROVIDER = '0x2dAd8162A989cd99D673dE4425Bb2298Db1E1aA2';
export const AAVE_POOL_ADDRESSES_PROVIDER = '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e';
// The reserves payload is large (every listed reserve), so it gets its own generous-but-bounded
// cap and its own deadline: an Aave failure must degrade only the Aave section, never the lookup.
export const AAVE_MAX_RESPONSE_BYTES = 256 * 1024;
export const AAVE_DEADLINE_MS = 5000;

type FeedId = 'ETH/USD' | 'USDC/USD' | 'USDT/USD' | 'DAI/USD';
// Feed addresses and descriptions were read on-chain on 2026-10-23 (description() matched) and match
// the data.chain.link and docs.chain.link address listings.
// Configured heartbeats come from Chainlink's own feed data (reviewer-sourced from
// https://data.chain.link/feeds, 23 Oct 2026): ETH/USD 3600 s, DAI/USD 3600 s, USDC/USD 82800 s,
// USDT/USD 86400 s. A price older than heartbeat + grace is Unknown. The grace covers a late
// transaction and clock skew; it is our choice, not a Chainlink figure.
export const HEARTBEAT_GRACE_S = 15 * 60;
const feed = (address: string, heartbeatS: number) => ({
  address,
  heartbeatS,
  maxAgeS: heartbeatS + HEARTBEAT_GRACE_S,
});
export const FEEDS = {
  'ETH/USD': feed('0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', 3600),
  'USDC/USD': feed('0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6', 82800),
  'USDT/USD': feed('0x3E7d1eAB13ad0104d2750B8863b489D65364e32D', 86400),
  'DAI/USD': feed('0xAed0c38402a5d19df6E4c03F4E2DcEd6e29c1ee9', 3600),
};

export const TOKENS = SUPPORTED_EVM_TOKENS;

const HEX = /^0x[0-9a-fA-F]+$/; // a bare "0x" is not a value
type Rpc = { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown };
// Only small integers are copied into diagnostics (JSON-RPC codes are within about +/-100000).
const isSafeRpcCode = (c: unknown): c is number =>
  typeof c === 'number' && Number.isSafeInteger(c) && Math.abs(c) <= 1_000_000;
const word = (hex: string, i: number) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);

export async function readCapped(res: Response, limit: number): Promise<string | null> {
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
    async fetchWallets(addresses, signal, opts?: FetchOptions): Promise<ProviderResult> {
      let diag: Diag = { step: 'build' };
      const fail = (kind: 'rate_limited' | 'timeout' | 'unavailable' | 'bad_response') =>
        ({ ok: false, provider: 'publicnode-rpc+chainlink', kind, diag }) as const;
      // ONE eth_call to Multicall3.aggregate3 at "latest". Every read below runs inside the same call,
      // so balances, feed rounds, block number and block time are one consistent state. Per-read
      // failures are allowed (allowFailure) so one bad token never hides the rest.
      const calls: Call3[] = [];
      const self = (data: string): number => {
        calls.push({ target: MULTICALL3, allowFailure: false, data });
        return calls.length - 1;
      };
      const add = (target: string, data: string): number => {
        calls.push({ target, allowFailure: true, data });
        return calls.length - 1;
      };
      const iBlock = self(SEL_GET_BLOCK_NUMBER);
      const iTime = self(SEL_GET_CURRENT_BLOCK_TIMESTAMP);
      const plan: { addr: number; token: number | null; idx: number }[] = [];
      addresses.forEach((a, ai) => {
        plan.push({
          addr: ai,
          token: null,
          idx: add(MULTICALL3, SEL_GET_ETH_BALANCE + addressWord(a)),
        });
        TOKENS.forEach((t, ti) => {
          plan.push({ addr: ai, token: ti, idx: add(t.address, SEL_BALANCE_OF + addressWord(a)) });
        });
      });
      const feedIds = Object.keys(FEEDS) as FeedId[];
      const feedAt = new Map<FeedId, { dec: number; round: number }>();
      for (const f of feedIds)
        feedAt.set(f, {
          dec: add(FEEDS[f].address, SEL_DECIMALS),
          round: add(FEEDS[f].address, SEL_LATEST_ROUND_DATA),
        });
      diag = { step: 'request', calls: calls.length };
      let res: Response;
      try {
        res = await d.fetch(d.rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [{ to: MULTICALL3, data: encodeAggregate3(calls) }, 'latest'],
          }),
          signal,
          redirect: 'manual',
        });
      } catch {
        return fail(signal.aborted ? 'timeout' : 'unavailable');
      }
      diag = { step: 'response', calls: calls.length, http: res.status };
      if (res.status === 429) return fail('rate_limited');
      if (!res.ok) return fail('unavailable');
      let text: string | null;
      try {
        text = await readCapped(res, MAX_RESPONSE_BYTES);
      } catch {
        return fail(signal.aborted ? 'timeout' : 'unavailable');
      }
      if (text === null) return fail('bad_response');
      let parsed: Rpc;
      try {
        parsed = JSON.parse(text) as Rpc;
      } catch {
        return fail('bad_response');
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return fail('bad_response');
      if (parsed.jsonrpc !== '2.0' || parsed.id !== 1) {
        diag = { ...diag, step: 'decode' };
        return fail('bad_response');
      }
      // JSON-RPC 2.0: exactly one of result and error.
      if ((parsed.error === undefined) === (parsed.result === undefined)) {
        diag = { ...diag, step: 'decode' };
        return fail('bad_response');
      }
      if (parsed.error !== undefined) {
        // Numeric JSON-RPC code only: the message can echo addresses, URLs or provider text.
        const code = (parsed.error as { code?: unknown } | null)?.code;
        diag = {
          ...diag,
          step: 'rpc_error',
          ...(isSafeRpcCode(code) ? { rpcCode: code } : {}),
        };
        return fail(code === -32005 || code === -32029 ? 'rate_limited' : 'unavailable');
      }
      if (typeof parsed.result !== 'string') return fail('bad_response');
      const results = decodeAggregate3(parsed.result, calls.length);
      if (!results) {
        diag = { ...diag, step: 'decode' };
        return fail('bad_response');
      }
      const out = new Map<number, string | null>();
      results.forEach((r, i) => out.set(i, r.success && HEX.test(r.data) ? r.data : null));
      const bnHex = out.get(iBlock);
      const tsHex = out.get(iTime);
      if (!bnHex || bnHex.length !== 66 || !tsHex || tsHex.length !== 66) {
        diag = { ...diag, step: 'block_info' };
        return fail('bad_response');
      }
      const bnBig = BigInt(bnHex);
      const chainS = BigInt(tsHex);
      if (
        bnBig === 0n ||
        bnBig > BigInt(Number.MAX_SAFE_INTEGER) ||
        chainS > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        diag = { ...diag, step: 'block_info' };
        return fail('bad_response');
      }
      const blockNumber = bnBig.toString();
      // Feed age is measured against the block's own time. If the node's latest block is far from
      // this server's clock the node is lagging, and ages would be wrong, so the lookup stops.
      const localS = Math.floor(d.now().getTime() / 1000);
      if (Math.abs(localS - Number(chainS)) > MAX_CLOCK_SKEW_S) {
        diag = { ...diag, step: 'stale_node' };
        return fail('bad_response');
      }
      const nowS = Number(chainS);
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
        const badLen = hex?.length !== 66;
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
      // Aave V3 positions (only when the deployment enables them): read through the same
      // PublicNode endpoint - no new vendor, no key. Any failure degrades this section to an
      // honest unavailable state; the wallet balances above are already settled and unaffected.
      if (opts?.aave) {
        // One bounded eth_call per request through the same JSON-RPC discipline as the
        // multicall above, with its own deadline so a slow Aave read cannot consume the
        // whole lookup budget.
        const aaveRpc: RpcCall = async (to, data) => {
          const fail = (reason: RpcFailure) => ({ ok: false as const, reason });
          const ctl = new AbortController();
          const onOuter = () => ctl.abort();
          if (signal.aborted) ctl.abort();
          else signal.addEventListener('abort', onOuter, { once: true });
          const timer = setTimeout(() => ctl.abort(), AAVE_DEADLINE_MS);
          try {
            let res: Response;
            try {
              res = await d.fetch(d.rpcUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 1,
                  method: 'eth_call',
                  params: [{ to, data }, 'latest'],
                }),
                signal: ctl.signal,
                redirect: 'manual',
              });
            } catch {
              return fail(ctl.signal.aborted && !signal.aborted ? 'timeout' : 'unavailable');
            }
            if (res.status === 429) return fail('rate_limited');
            if (!res.ok) return fail('unavailable');
            let text: string | null;
            try {
              text = await readCapped(res, AAVE_MAX_RESPONSE_BYTES);
            } catch {
              return fail(ctl.signal.aborted && !signal.aborted ? 'timeout' : 'unavailable');
            }
            if (text === null) return fail('bad_response');
            let parsed: Rpc;
            try {
              parsed = JSON.parse(text) as Rpc;
            } catch {
              return fail('bad_response');
            }
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
              return fail('bad_response');
            if (parsed.jsonrpc !== '2.0' || parsed.id !== 1) return fail('bad_response');
            if ((parsed.error === undefined) === (parsed.result === undefined))
              return fail('bad_response');
            if (parsed.error !== undefined) {
              const code = (parsed.error as { code?: unknown } | null)?.code;
              return fail(code === -32005 || code === -32029 ? 'rate_limited' : 'unavailable');
            }
            if (typeof parsed.result !== 'string' || !HEX.test(parsed.result))
              return fail('bad_response');
            return { ok: true as const, result: parsed.result };
          } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', onOuter);
          }
        };
        const sections = await readAaveV3PositionsForUsers(aaveRpc, {
          poolAddressesProvider: AAVE_POOL_ADDRESSES_PROVIDER,
          uiPoolDataProvider: AAVE_UI_POOL_DATA_PROVIDER,
          users: addresses,
        });
        // Prices come only from this app's own verified Chainlink feeds (read in the multicall
        // above), matched by the underlying token address - never from Aave's reference prices.
        const feedFor = new Map(TOKENS.map((t) => [t.address.toLowerCase(), t.feed] as const));
        const view = (p: AavePosition): AavePositionView => {
          const feedId = feedFor.get(p.underlyingAsset.toLowerCase());
          const price = feedId ? prices.get(feedId) : undefined;
          const notes: string[] = [];
          if (!p.reserveFlags.isActive) notes.push('not active');
          if (p.reserveFlags.isFrozen) notes.push('frozen');
          if (p.reserveFlags.isPaused) notes.push('paused');
          return {
            underlyingAsset: p.underlyingAsset,
            symbol: p.symbol,
            decimals: p.decimals,
            supplied: formatUnits(p.suppliedRaw, p.decimals),
            variableDebt: formatUnits(p.variableDebtRaw, p.decimals),
            suppliedValueUsd:
              p.suppliedRaw === 0n ? '0' : price ? valueUsd(p.suppliedRaw, p.decimals, price.price) : null,
            variableDebtValueUsd:
              p.variableDebtRaw === 0n
                ? '0'
                : price
                  ? valueUsd(p.variableDebtRaw, p.decimals, price.price)
                  : null,
            priceSource: price && feedId ? `chainlink:${feedId}` : null,
            priceObservedAt: price ? price.at : null,
            // The reserve's stored-index observation time, never the fetch time.
            observedAt: new Date(Number(p.observedAt) * 1000).toISOString(),
            usageAsCollateralEnabled: p.usageAsCollateralEnabled,
            reserveNote: notes.length ? `This reserve is ${notes.join(' and ')} on Aave.` : null,
          };
        };
        wallets.forEach((w, i) => {
          const s = sections.get(addresses[i]!);
          if (!s || s.kind === 'unavailable') {
            w.aave = {
              status: 'unavailable',
              reason:
                !s || s.reason === 'bad_payload' || s.reason === 'bad_response'
                  ? 'bad_response'
                  : s.reason,
            };
            return;
          }
          w.aave = { status: 'ok', positions: s.positions.map(view) };
        });
      }
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
