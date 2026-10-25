import { formatUnits, valueUsd } from './units';
import type { Asset, WalletResult } from './contract';
import type { Diag, PortfolioProvider, ProviderResult } from './provider';
import {
  decodeAggregate3,
  encodeAggregate3,
  SEL_DECIMALS,
  SEL_GET_BLOCK_NUMBER,
  SEL_GET_CURRENT_BLOCK_TIMESTAMP,
  SEL_LATEST_ROUND_DATA,
  type Call3,
} from './abi';
import {
  FEED_DECIMALS,
  HEARTBEAT_GRACE_S,
  MAX_CLOCK_SKEW_S,
  MAX_FUTURE_S,
  MAX_RESPONSE_BYTES,
  MULTICALL3,
  readCapped,
  RPC_URL as ETH_RPC_URL,
} from './live-provider';

// DEFAULT-OFF live read-only Solana provider. SCOPE: the SOL balance only, read with getBalance
// over PublicNode's free Solana RPC (no key, no account). SPL token balances are NOT read: the
// needed getTokenAccountsByOwner call is an "indexed request" that PublicNode's free tier rejects
// (it requires a personal token, i.e. an account), and no other provider has been vetted for this
// app. A missing token must never read as an empty wallet.
export const SOLANA_RPC_URL = 'https://solana-rpc.publicnode.com';
export const SOL_DECIMALS = 9; // lamports per SOL

// USD reference price: Chainlink SOL/USD on Ethereum mainnet, read through the same PublicNode
// Ethereum RPC the ETH provider uses (no second vendor, no key). Identity verified two ways on
// 2026-10-24: on-chain description() returns "SOL / USD" with decimals() 8, and the proxy address
// matches Chainlink's official Ethereum mainnet feed registry
// (reference-data-directory.vercel.app/feeds-mainnet.json, the data source behind data.chain.link:
// pair "SOL / USD", proxyAddress 0x4ffC43a60e009B551865A93d232E33Fce9f01507, heartbeat 86400).
// The 24h heartbeat is that feed's own published value - not the ETH/USD feed's 1h heartbeat.
// A price older than heartbeat + grace, or dated in the future, is shown as Unknown, never guessed.
export const SOL_USD_FEED = {
  address: '0x4ffC43a60e009B551865A93d232E33Fce9f01507',
  heartbeatS: 86400,
  maxAgeS: 86400 + HEARTBEAT_GRACE_S,
};

const HEX = /^0x[0-9a-fA-F]+$/;
const word = (hex: string, i: number) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const isSafeRpcCode = (c: unknown): c is number =>
  typeof c === 'number' && Number.isSafeInteger(c) && Math.abs(c) <= 1_000_000;

export type SolanaLiveDeps = {
  fetch: typeof fetch;
  now: () => Date;
  solanaRpcUrl: string;
  ethRpcUrl: string;
};

export function createSolanaLiveProvider(over: Partial<SolanaLiveDeps> = {}): PortfolioProvider {
  const d: SolanaLiveDeps = {
    fetch: (...a) => fetch(...a),
    now: () => new Date(),
    solanaRpcUrl: SOLANA_RPC_URL,
    ethRpcUrl: ETH_RPC_URL,
    ...over,
  };
  const NAME = 'publicnode-solana+chainlink';
  return {
    name: NAME,
    simulated: false,
    async fetchWallets(addresses, signal): Promise<ProviderResult> {
      let diag: Diag = { step: 'build' };
      const fail = (kind: 'rate_limited' | 'timeout' | 'unavailable' | 'bad_response') =>
        ({ ok: false, provider: NAME, kind, diag }) as const;

      // Step 1: ONE eth_call to Multicall3 for the block number, block time and the SOL/USD feed
      // round, all in one consistent Ethereum state. The feed lives on Ethereum, so its age is
      // measured against that chain's block time, and a lagging node is rejected the same way as
      // in the Ethereum provider.
      const calls: Call3[] = [
        { target: MULTICALL3, allowFailure: false, data: SEL_GET_BLOCK_NUMBER },
        { target: MULTICALL3, allowFailure: false, data: SEL_GET_CURRENT_BLOCK_TIMESTAMP },
        { target: SOL_USD_FEED.address, allowFailure: true, data: SEL_DECIMALS },
        { target: SOL_USD_FEED.address, allowFailure: true, data: SEL_LATEST_ROUND_DATA },
      ];
      diag = { step: 'request', calls: calls.length + addresses.length };
      let res: Response;
      try {
        res = await d.fetch(d.ethRpcUrl, {
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
      diag = { step: 'response', calls: calls.length + addresses.length, http: res.status };
      if (res.status === 429) return fail('rate_limited');
      if (!res.ok) return fail('unavailable');
      let text: string | null;
      try {
        text = await readCapped(res, MAX_RESPONSE_BYTES);
      } catch {
        return fail(signal.aborted ? 'timeout' : 'unavailable');
      }
      if (text === null) return fail('bad_response');
      let ethParsed: { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown };
      try {
        ethParsed = JSON.parse(text);
      } catch {
        return fail('bad_response');
      }
      if (ethParsed.jsonrpc !== '2.0' || ethParsed.id !== 1) {
        diag = { ...diag, step: 'decode' };
        return fail('bad_response');
      }
      if (ethParsed.error !== undefined) {
        const code = (ethParsed.error as { code?: unknown } | null)?.code;
        diag = {
          ...diag,
          step: 'rpc_error',
          ...(isSafeRpcCode(code) ? { rpcCode: code } : {}),
        };
        return fail(code === -32005 || code === -32029 ? 'rate_limited' : 'unavailable');
      }
      if (typeof ethParsed.result !== 'string') return fail('bad_response');
      const results = decodeAggregate3(ethParsed.result, calls.length);
      if (!results) {
        diag = { ...diag, step: 'decode' };
        return fail('bad_response');
      }
      const get = (i: number) => {
        const r = results[i]!;
        return r.success && HEX.test(r.data) ? r.data : null;
      };
      const bnHex = get(0);
      const tsHex = get(1);
      if (!bnHex || bnHex.length !== 66 || !tsHex || tsHex.length !== 66) {
        diag = { ...diag, step: 'block_info' };
        return fail('bad_response');
      }
      const chainS = BigInt(tsHex);
      if (chainS === 0n || chainS > BigInt(Number.MAX_SAFE_INTEGER)) {
        diag = { ...diag, step: 'block_info' };
        return fail('bad_response');
      }
      const localS = Math.floor(d.now().getTime() / 1000);
      if (Math.abs(localS - Number(chainS)) > MAX_CLOCK_SKEW_S) {
        diag = { ...diag, step: 'stale_node' };
        return fail('bad_response');
      }
      const nowS = Number(chainS);

      // Price: valid only when decimals are 8, the answer is positive and the round is fresh.
      let price: { price: string; at: string } | null = null;
      const dec = get(2);
      const round = get(3);
      if (dec && dec.length === 66 && round && round.length === 2 + 5 * 64) {
        if (BigInt(dec) === BigInt(FEED_DECIMALS)) {
          const roundId = BigInt('0x' + word(round, 0));
          const answer = BigInt('0x' + word(round, 1));
          const started = BigInt('0x' + word(round, 2));
          const updatedBig = BigInt('0x' + word(round, 3));
          if (
            roundId !== 0n &&
            started !== 0n &&
            updatedBig !== 0n &&
            started <= updatedBig &&
            answer > 0n &&
            answer < 1n << 255n &&
            updatedBig <= BigInt(Number.MAX_SAFE_INTEGER)
          ) {
            const updated = Number(updatedBig);
            if (nowS - updated <= SOL_USD_FEED.maxAgeS && updated - nowS <= MAX_FUTURE_S)
              price = { price: formatUnits(answer, FEED_DECIMALS), at: new Date(updated * 1000).toISOString() };
          }
        }
      }

      // Step 2: ONE batched Solana JSON-RPC POST with getBalance per address (finalized). A batch
      // is one HTTP request; each element carries its own context.slot.
      diag = { step: 'request', calls: calls.length + addresses.length };
      let sres: Response;
      try {
        sres = await d.fetch(d.solanaRpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            addresses.map((a, i) => ({
              jsonrpc: '2.0',
              id: i + 1,
              method: 'getBalance',
              params: [a, { commitment: 'finalized' }],
            })),
          ),
          signal,
          redirect: 'manual',
        });
      } catch {
        return fail(signal.aborted ? 'timeout' : 'unavailable');
      }
      diag = { step: 'response', calls: calls.length + addresses.length, http: sres.status };
      if (sres.status === 429) return fail('rate_limited');
      if (!sres.ok) return fail('unavailable');
      let stext: string | null;
      try {
        stext = await readCapped(sres, MAX_RESPONSE_BYTES);
      } catch {
        return fail(signal.aborted ? 'timeout' : 'unavailable');
      }
      if (stext === null) return fail('bad_response');
      // Receipt time of the balance response, not the Ethereum pricing block's timestamp.
      const balanceObservedAt = d.now().toISOString();
      let items: unknown;
      try {
        items = JSON.parse(stext);
      } catch {
        return fail('bad_response');
      }
      if (!Array.isArray(items)) {
        diag = { ...diag, step: 'decode' };
        return fail('bad_response');
      }
      type SolItem = {
        jsonrpc?: unknown;
        id?: unknown;
        result?: { context?: { slot?: unknown }; value?: unknown } | null;
        error?: { code?: unknown } | null;
      };
      const byId = new Map<number, SolItem>();
      for (const it of items as SolItem[]) {
        if (typeof it === 'object' && it !== null && typeof it.id === 'number') byId.set(it.id, it);
      }
      let slot: number | null = null;
      const wallets: WalletResult[] = addresses.map((address, i) => {
        const w: WalletResult = { address, assets: [], partial: false, warnings: [] };
        const it = byId.get(i + 1);
        if (!it || it.jsonrpc !== '2.0') {
          w.partial = true;
          w.warnings.push('SOL balance could not be read; this is not a zero balance.');
          return w;
        }
        if (it.error) {
          // A per-item RPC error hides only this wallet's balance; the rest still report.
          w.partial = true;
          w.warnings.push('SOL balance could not be read; this is not a zero balance.');
          return w;
        }
        const r = it.result;
        const lamports = r?.value;
        const itSlot = r?.context?.slot;
        if (
          typeof lamports !== 'number' ||
          !Number.isSafeInteger(lamports) ||
          lamports < 0 ||
          typeof itSlot !== 'number' ||
          !Number.isSafeInteger(itSlot)
        ) {
          w.partial = true;
          w.warnings.push('SOL balance could not be read; this is not a zero balance.');
          return w;
        }
        if (slot === null) slot = itSlot;
        if (lamports > 0) {
          const raw = BigInt(lamports);
          const a: Asset = {
            assetId: 'solana:mainnet/native',
            symbol: 'SOL',
            decimals: SOL_DECIMALS,
            rawAmount: raw.toString(),
            amount: formatUnits(raw, SOL_DECIMALS),
            price: price ? price.price : null,
            value: price ? valueUsd(raw, SOL_DECIMALS, price.price) : null,
            priceSource: price ? 'chainlink:SOL/USD' : null,
            priceObservedAt: price ? price.at : null,
          };
          w.assets.push(a);
        }
        return w;
      });
      for (const w of wallets) {
        if (slot !== null)
          w.warnings.push(
            `Balances were read together at Solana slot ${slot}. The USD reference price is the Chainlink SOL/USD feed on Ethereum mainnet, updated ${price ? price.at : 'unknown'}.`,
          );
        else
          w.warnings.push(
            'The Solana slot could not be read; balance freshness cannot be shown.',
          );
      }
      for (const w of wallets)
        if (w.assets.some((a) => a.price === null) && !w.warnings.some((x) => x.includes('price')))
          w.warnings.push(
            'A USD price was unavailable; values are shown without it. An unpriced asset is not a zero balance.',
          );
      return {
        ok: true,
        provider: NAME,
        simulated: false,
        observedAt: balanceObservedAt,
        wallets,
      };
    },
  };
}
