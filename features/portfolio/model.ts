export type Position = {
  id: string;
  exposureId: string;
  assetId: string;
  symbol: string;
  network: 'Ethereum' | 'Solana';
  kind: 'Wallet' | 'Supplied' | 'Debt' | 'Liquidity' | 'Receipt';
  quantity: string;
  valueCents: bigint | null;
};
export function uniqueExposures(positions: readonly Position[]) {
  const seen = new Set<string>();
  return positions.filter((position) => {
    if (position.kind === 'Receipt' || seen.has(position.exposureId)) return false;
    seen.add(position.exposureId);
    return true;
  });
}
export function summarize(positions: readonly Position[]) {
  let assets = 0n,
    debt = 0n;
  let unpriced = 0;
  for (const position of uniqueExposures(positions)) {
    if (position.valueCents === null) {
      unpriced++;
      continue;
    }
    if (position.valueCents < 0n)
      throw new Error('Position values must be nonnegative; debt direction uses kind.');
    if (position.kind === 'Debt') debt += position.valueCents;
    else assets += position.valueCents;
  }
  return { assets, debt, net: assets - debt, unpriced, incomplete: unpriced > 0 };
}
export function money(cents: bigint | null): string {
  if (cents === null) return 'Unknown';
  const absolute = cents < 0n ? -cents : cents;
  const dollars = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0n ? '−' : ''}$${dollars}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
/** Gross priced asset allocation, deliberately excluding debt and unpriced exposure. */
export function networkAllocation(positions: readonly Position[]) {
  const byNetwork = new Map<Position['network'], bigint>();
  for (const position of uniqueExposures(positions)) {
    if (position.kind === 'Debt' || position.valueCents === null) continue;
    byNetwork.set(position.network, (byNetwork.get(position.network) ?? 0n) + position.valueCents);
  }
  const total = [...byNetwork.values()].reduce((sum, value) => sum + value, 0n);
  return [...byNetwork].map(([network, value]) => ({
    network,
    value,
    // Only the bounded percentage becomes a Number; monetary calculations remain exact.
    percent: total === 0n ? 0 : Number((value * 1000n + total / 2n) / total) / 10,
  }));
}

/** Gross priced asset allocation by symbol (debt and unpriced exposure excluded). Exact cents; one bounded percent per row. */
export function assetAllocation(positions: readonly Position[]) {
  const bySymbol = new Map<string, bigint>();
  for (const position of uniqueExposures(positions)) {
    if (position.kind === 'Debt' || position.valueCents === null) continue;
    bySymbol.set(position.symbol, (bySymbol.get(position.symbol) ?? 0n) + position.valueCents);
  }
  const total = [...bySymbol.values()].reduce((sum, value) => sum + value, 0n);
  return [...bySymbol]
    .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] > b[1] ? -1 : 1))
    .map(([symbol, value]) => ({
      symbol,
      value,
      percent: total === 0n ? 0 : Number((value * 1000n + total / 2n) / total) / 10,
    }));
}
/** Stable palette index per symbol so a symbol keeps its colour in the donut, legend and table. */
export const SYMBOL_COLORS = ['#d8b45c', '#8b7cf6', '#4fb8a6', '#e07a8a', '#6aa6e8', '#c98a4b'];
const KNOWN: Record<string, string> = {
  ETH: '#8b7cf6',
  SOL: '#4fb8a6',
  USDC: '#6aa6e8',
  'SOL / USDC': '#d8b45c',
  DEMO: '#c98a4b',
};
export function symbolColor(symbol: string): string {
  if (KNOWN[symbol]) return KNOWN[symbol];
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SYMBOL_COLORS[h % SYMBOL_COLORS.length]!;
}
