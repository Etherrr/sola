// Multi-address portfolio aggregation: combines per-address lookup results into Position
// rows for the existing model (summarize / networkAllocation / holdingAllocation). PURE:
// no fetch, no state, no clock. Fetching stays in api-client.ts behind explicit user action.
//
// Honesty rules (load-bearing):
// - The same (network, address) submitted twice is a duplicate, never a second holding.
// - The same asset in two DIFFERENT wallets is two real holdings; it is never merged.
// - Within one wallet a repeated assetId is a bad payload: the first row wins, the rest are
//   ignored with a warning, so a misbehaving source cannot double-count.
// - Unknown price stays unknown (valueCents null); it is never guessed or zero-filled.
// - Every source keeps its OWN observedAt; the aggregate reports the range, never "now".
// - Quantity strings pass through verbatim; USD values convert exactly (see usdToCents).
import type { ApiSuccess } from './api-client';
import type { Position } from './model';

export type AddressNetwork = 'ethereum' | 'solana';
export type LookupResult =
  | { kind: 'ok'; data: ApiSuccess }
  | { kind: 'error'; message: string; retryable: boolean };

export type AggregateInput = {
  network: AddressNetwork;
  address: string;
  label?: string;
  outcome: LookupResult;
};

export type AddressStatus = {
  network: AddressNetwork;
  address: string;
  label?: string;
  status: 'ok' | 'partial' | 'failed' | 'duplicate';
  warnings: string[];
  /** The source's own observation time for this address; null when no data was read. */
  observedAt: string | null;
  unpricedAssets: number;
};

export type AggregateResult = {
  positions: Position[];
  perAddress: AddressStatus[];
  /** True when any address failed, was partial, or holds unpriced assets. */
  incomplete: boolean;
  /** Earliest and latest source observation times across contributing addresses. */
  observedRange: { earliest: string; latest: string } | null;
};

const NETWORK_NAME: Record<AddressNetwork, Position['network']> = {
  ethereum: 'Ethereum',
  solana: 'Solana',
};

/**
 * Exact USD decimal string -> cents. Up to 6 fractional digits are read exactly; further
 * digits are truncated (well below one cent) and the result rounds half-up to the cent.
 * Returns null for anything that is not a plain non-negative decimal string.
 */
export function usdToCents(value: string): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) return null;
  const frac = (m[2] ?? '').padEnd(6, '0').slice(0, 6);
  const micro = BigInt(m[1]) * 1_000_000n + BigInt(frac || '0');
  return (micro + 5_000n) / 10_000n;
}

export function aggregateAddresses(inputs: readonly AggregateInput[]): AggregateResult {
  const positions: Position[] = [];
  const perAddress: AddressStatus[] = [];
  const seen = new Set<string>();
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const input of inputs) {
    const key = `${input.network}:${input.address.toLowerCase()}`;
    if (seen.has(key)) {
      perAddress.push({
        network: input.network,
        address: input.address,
        label: input.label,
        status: 'duplicate',
        warnings: ['Same address submitted twice; counted once.'],
        observedAt: null,
        unpricedAssets: 0,
      });
      continue;
    }
    seen.add(key);

    if (input.outcome.kind !== 'ok') {
      perAddress.push({
        network: input.network,
        address: input.address,
        label: input.label,
        status: 'failed',
        warnings: [input.outcome.message],
        observedAt: null,
        unpricedAssets: 0,
      });
      continue;
    }

    const { data } = input.outcome;
    const warnings = [...data.warnings];
    let unpriced = 0;
    const seenAssets = new Set<string>();
    for (const wallet of data.wallets) {
      for (const asset of wallet.assets) {
        if (seenAssets.has(asset.assetId)) {
          warnings.push(`Duplicate ${asset.symbol} entry from the source ignored.`);
          continue;
        }
        seenAssets.add(asset.assetId);
        const cents = asset.value === null ? null : usdToCents(asset.value);
        if (cents === null) unpriced++;
        const id = `${input.network}:${input.address}:${asset.assetId}`;
        positions.push({
          id,
          exposureId: id, // each wallet holding is its own exposure; no receipts here
          assetId: asset.assetId,
          symbol: asset.symbol,
          network: NETWORK_NAME[input.network],
          kind: 'Wallet',
          quantity: asset.amount,
          valueCents: cents,
        });
      }
    }

    if (earliest === null || data.observedAt < earliest) earliest = data.observedAt;
    if (latest === null || data.observedAt > latest) latest = data.observedAt;
    perAddress.push({
      network: input.network,
      address: input.address,
      label: input.label,
      status: data.partial ? 'partial' : 'ok',
      warnings,
      observedAt: data.observedAt,
      unpricedAssets: unpriced,
    });
  }

  const incomplete = perAddress.some(
    (a) => a.status === 'failed' || a.status === 'partial' || a.unpricedAssets > 0,
  );
  return {
    positions,
    perAddress,
    incomplete,
    observedRange: earliest === null ? null : { earliest, latest: latest as string },
  };
}
