import type { NetworkSlice, ObservedAmount } from './overview-history';

/**
 * Pure per-network delta computation for What-changed (reviewer MEDIUM
 * regression guard). A network's rows are compared ONLY against that
 * network's own prior complete observation: a missing prior means every
 * row is "first seen", and another network's prior NEVER contributes.
 * Absent-in-latest rows are returned explicitly (never silently dropped,
 * never read as zero).
 */

// Chain-aware identity key: EVM hex compares case-insensitively, Solana
// base58 is case-sensitive - never normalize Solana.
export const keyOf = (o: ObservedAmount) =>
  `${o.network}:${o.network === 'ethereum' ? o.address.toLowerCase() : o.address}:${o.assetId}:${o.kind}`;

const isZero = (s: string) => {
  const m = /^-?(\d+)(?:\.(\d+))?$/.exec(s);
  return m !== null && BigInt((m[1] + (m[2] ?? '')).replace(/^0+(?=\d)/, '') || '0') === 0n;
};

export const subDec = (a: string, b: string): string => {
  const parse = (s: string) => {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s)!;
    return { neg: m[1] === '-', int: m[2], frac: m[3] ?? '' };
  };
  const pa = parse(a), pb = parse(b);
  const w = Math.max(pa.frac.length, pb.frac.length);
  const toBig = (p: typeof pa) => {
    const digits = (p.int + p.frac.padEnd(w, '0')).replace(/^0+(?=\d)/, '');
    return BigInt(digits) * (p.neg ? -1n : 1n);
  };
  const d = toBig(pa) - toBig(pb);
  const neg = d < 0n;
  const abs = (neg ? -d : d).toString().padStart(w + 1, '0');
  const int = w ? abs.slice(0, -w) : abs;
  const frac = w ? abs.slice(-w).replace(/0+$/, '') : '';
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
};

export type DiffRow = { o: ObservedAmount; prev: string | undefined; delta: string };
export type NetworkDiff = {
  /** Changed or first-seen rows (zero deltas against a known prior excluded). */
  rows: DiffRow[];
  /** Prior rows absent from the latest observation (zero or unread - stated, never dropped). */
  removed: ObservedAmount[];
};

export function diffNetwork(sec: Pick<NetworkSlice, 'latest' | 'prior'>): NetworkDiff {
  const priorByKey = new Map<string, string>();
  if (sec.prior) for (const o of sec.prior) priorByKey.set(keyOf(o), o.amount);
  const latestKeys = new Set(sec.latest.map(keyOf));
  const rows = sec.latest
    .map((o) => {
      const prev = priorByKey.get(keyOf(o));
      const delta = prev === undefined ? o.amount : subDec(o.amount, prev);
      return { o, prev, delta };
    })
    .filter((r) => r.prev === undefined || !isZero(r.delta));
  const removed = (sec.prior ?? []).filter((o) => !latestKeys.has(keyOf(o)));
  return { rows, removed };
}

export { isZero };
