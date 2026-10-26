/**
 * Unified read model (plan §6 / Phase C.4): Overview, Assets, DeFi and
 * Risk & Return all read the SAME normalized positions, so every screen's
 * figures reconcile by construction. Pure functions over Position[] plus the
 * prior observation (for change detection) - no I/O, no floats.
 *
 * Truthfulness rules (plan §6):
 * - "Share" is a share of the PRICED subtotal only, and says so.
 * - Change detection compares actual recorded observations; without a prior
 *   observation the honest state is "first recorded observation".
 * - Risk analytics cover RECOGNIZED positions only and are marked partial
 *   whenever coverage is partial.
 * - No P&L, no returns, no yields - "Not yet calculated" is the answer.
 */
import {
  addDecimal,
  addressKey,
  divDecimal,
  isPriceFresh,
  isZero,
  netProtocolAmount,
  subDecimal,
  summarize,
  type Position,
} from './domain';

/** Round an unsigned decimal string to `dp` places (half-up), exact string math. */
function roundDecimal(v: string, dp: number): string {
  const neg = v.startsWith('-');
  const body = neg ? v.slice(1) : v;
  const [w, f = ''] = body.split('.');
  if (f.length <= dp) { const t = f.replace(/0+$/, ''); return `${neg ? '-' : ''}${w}${t ? '.' + t : ''}`; }
  const keep = f.slice(0, dp);
  const bump = Number(f[dp]) >= 5;
  const digits = (BigInt(w + keep) + (bump ? 1n : 0n)).toString().padStart(dp + 1, '0');
  const whole = digits.slice(0, digits.length - dp) || '0';
  const frac = dp ? digits.slice(digits.length - dp).replace(/0+$/, '') : '';
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** Percent share (2dp) of part over whole, or null when whole is zero. */
const pctShare = (part: string, whole: string): string | null =>
  isZero(whole) ? null : roundDecimal(divDecimal(mul100(part), whole), 2);

/* ---------- Assets view ---------- */

export type AssetRow = {
  assetId: string;
  symbol: string;
  network: string;
  address: string;
  kind: Position['kind'];
  amount: string;
  priceUsd: string | null;
  valueUsd: string | null;
  /** Share of the PRICED subtotal (2dp percent), null when unpriced. */
  shareOfPricedPct: string | null;
  observedAt: string;
  source: string;
  priceStale: boolean;
};

export function assetsView(positions: Position[]): AssetRow[] {
  const s = summarize(positions);
  const pricedBase = addDecimal(s.spotPricedUsd, s.suppliedPricedUsd);
  return positions
    .filter((p) => !isZero(p.amount))
    .map((p) => {
      const fresh = isPriceFresh(p);
      const priced = p.price !== null && p.valueUsd !== null && fresh && !isZero(pricedBase);
      return {
        assetId: p.asset.assetId,
        symbol: p.asset.symbol,
        network: p.network,
        address: p.address,
        kind: p.kind,
        amount: p.amount,
        priceUsd: p.price?.usd ?? null,
        valueUsd: p.valueUsd,
        shareOfPricedPct: priced ? pctShare(p.valueUsd!, pricedBase) : null,
        observedAt: p.observedAt,
        source: p.source,
        priceStale: p.price !== null && !fresh,
      };
    });
}

/** value * 100, exact at the value's own precision. */
const mul100 = (v: string): string => {
  const neg = v.startsWith('-');
  const body = neg ? v.slice(1) : v;
  const [w, f = ''] = body.split('.');
  const digits = w + f;
  const fracLen = f.length;
  const scaled = BigInt(digits) * 100n;
  const s = scaled.toString().padStart(fracLen + 1, '0');
  const whole = s.slice(0, s.length - fracLen || undefined) || '0';
  const frac = fracLen ? s.slice(s.length - fracLen).replace(/0+$/, '') : '';
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
};

/* ---------- DeFi view ---------- */

export type ProtocolPositionRow = {
  protocol: string;
  network: string;
  address: string;
  assetId: string;
  symbol: string;
  supplied: string;
  debt: string;
  /** Signed net (supplied - debt); may be negative. */
  net: string;
  /** USD sums over FRESH-priced contributions only; stale prices are excluded
   *  (never silently summed) and flagged via priceStale. */
  suppliedValueUsd: string | null;
  debtValueUsd: string | null;
  /** TRUE when any contributing position had a price too stale to use. */
  priceStale: boolean;
  observedAt: string;
};

export function defiView(positions: Position[]): ProtocolPositionRow[] {
  const keys = new Map<string, ProtocolPositionRow>();
  for (const p of positions) {
    if (p.protocol === null || p.kind === 'wallet_balance') continue;
    // Chain-aware identity: two EVM case forms of ONE address group together;
    // two Solana addresses differing only by case NEVER merge.
    const k = [p.protocol, p.network, addressKey(p.network, p.address), p.asset.assetId].join('|');
    if (!keys.has(k)) {
      keys.set(k, {
        protocol: p.protocol,
        network: p.network,
        address: p.address,
        assetId: p.asset.assetId,
        symbol: p.asset.symbol,
        supplied: '0',
        debt: '0',
        net: '0',
        suppliedValueUsd: null,
        debtValueUsd: null,
        priceStale: false,
        observedAt: p.observedAt,
      });
    }
    const row = keys.get(k)!;
    const fresh = isPriceFresh(p);
    if (p.price !== null && !fresh) row.priceStale = true;
    if (p.kind === 'protocol_supplied') {
      row.supplied = addDecimal(row.supplied, p.amount);
      if (p.valueUsd !== null && fresh) row.suppliedValueUsd = addDecimal(row.suppliedValueUsd ?? '0', p.valueUsd);
    } else {
      row.debt = addDecimal(row.debt, p.amount);
      if (p.valueUsd !== null && fresh) row.debtValueUsd = addDecimal(row.debtValueUsd ?? '0', p.valueUsd);
    }
    if (p.observedAt > row.observedAt) row.observedAt = p.observedAt;
  }
  for (const row of keys.values())
    row.net = netProtocolAmount(positions, row.protocol, row.network as 'ethereum' | 'solana', row.address, row.assetId);
  return [...keys.values()];
}

/* ---------- Overview: change since prior observation ---------- */

export type ObservedAmount = {
  assetId: string;
  network: 'ethereum' | 'solana';
  address: string;
  kind: Position['kind'];
  amount: string;
  observedAt: string;
};

/** Identity of one observed position: asset at an address on a network of a
 *  kind - chain-aware addressKey, so EVM case forms reconcile and Solana
 *  case-distinct addresses never collapse into one history. */
const obsKey = (o: { assetId: string; network: 'ethereum' | 'solana'; address: string; kind: Position['kind'] }): string =>
  [o.assetId, o.network, addressKey(o.network, o.address), o.kind].join('|');

export type ChangeRow = {
  assetId: string;
  symbol: string;
  network: Position['network'];
  address: string;
  kind: Position['kind'];
  previousAmount: string;
  currentAmount: string;
  /** Signed delta; may be negative. */
  delta: string;
};

/** Compare the current positions against the PRIOR recorded observation for the
 *  same portfolio. Returns null (honest empty state) when no prior observation
 *  exists - the UI shows "History begins after your first recorded observation". */
export function changesSincePrior(
  current: Position[],
  prior: ObservedAmount[] | null,
): ChangeRow[] | null {
  if (prior === null || prior.length === 0) return null;
  // Sum duplicate identities (defensive: the writer dedupes, the reader never
  // assumes) so both sides of the comparison share ONE granularity.
  const priorByKey = new Map<string, string>();
  for (const o of prior) priorByKey.set(obsKey(o), addDecimal(priorByKey.get(obsKey(o)) ?? '0', o.amount));
  const out: ChangeRow[] = [];
  for (const p of current) {
    const key = obsKey({ assetId: p.asset.assetId, network: p.network, address: p.address, kind: p.kind });
    const prev = priorByKey.get(key);
    if (prev === undefined) {
      if (!isZero(p.amount))
        out.push({ assetId: p.asset.assetId, symbol: p.asset.symbol, network: p.network, address: p.address, kind: p.kind, previousAmount: '0', currentAmount: p.amount, delta: p.amount });
      continue;
    }
    const delta = subDecimal(p.amount, prev);
    if (!isZero(delta))
      out.push({ assetId: p.asset.assetId, symbol: p.asset.symbol, network: p.network, address: p.address, kind: p.kind, previousAmount: prev, currentAmount: p.amount, delta });
  }
  return out;
}

/* ---------- Risk view ---------- */

export type ConcentrationRow = { label: string; valueUsd: string; sharePct: string };

export type RiskView = {
  /** Concentrations over FRESH-PRICED positions only. */
  byChain: ConcentrationRow[];
  byAsset: ConcentrationRow[];
  byProtocol: ConcentrationRow[];
  /** known debt / known priced assets, 4dp; null when no priced assets. */
  debtToKnownAssets: string | null;
  stablecoinSharePct: string | null;
  /** TRUE whenever any recognized position is unpriced or stale - every figure
   *  above then describes a PARTIAL picture and must be labeled so. */
  partial: boolean;
};

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDS', 'PYUSD', 'FRAX']);

export function riskView(positions: Position[]): RiskView {
  const s = summarize(positions);
  const fresh = positions.filter((p) => !isZero(p.amount) && p.valueUsd !== null && isPriceFresh(p) && p.kind !== 'protocol_debt');
  const total = fresh.reduce((acc, p) => addDecimal(acc, p.valueUsd!), '0');
  const group = (key: (p: Position) => string): ConcentrationRow[] => {
    const m = new Map<string, string>();
    for (const p of fresh) m.set(key(p), addDecimal(m.get(key(p)) ?? '0', p.valueUsd!));
    return [...m.entries()]
      .map(([label, valueUsd]) => ({
        label,
        valueUsd,
        sharePct: pctShare(valueUsd, total) ?? '0',
      }))
      .sort((a, b) => (a.valueUsd < b.valueUsd ? 1 : -1));
  };
  const stable = fresh
    .filter((p) => STABLECOINS.has(p.asset.symbol.toUpperCase()))
    .reduce((acc, p) => addDecimal(acc, p.valueUsd!), '0');
  return {
    byChain: group((p) => p.network),
    byAsset: group((p) => p.asset.symbol),
    byProtocol: group((p) => p.protocol ?? 'wallet'),
    debtToKnownAssets: isZero(addDecimal(s.spotPricedUsd, s.suppliedPricedUsd))
      ? null
      : roundDecimal(divDecimal(s.debtPricedUsd, addDecimal(s.spotPricedUsd, s.suppliedPricedUsd)), 4),
    stablecoinSharePct: isZero(total) ? null : roundDecimal(divDecimal(mul100(stable), total), 2),
    partial: s.coverage === 'partial',
  };
}

/* ---------- Overview view (plan 6.1, reviewer binding verdict A1-A5 + PIN1-3) ---------- */

export type OverviewTotals = {
  /** Non-debt rows with a non-zero amount (the known-empty discriminator,
   *  PIN1: zero asset rows + debt rows -> gross '0' observed-empty). */
  assetRowCount: number;
  /** Gross priced value of recognized asset positions (spot + supplied,
   *  fresh prices only, debt NEVER inside). null = UNKNOWN (asset rows
   *  exist, none fresh-priced: all unpriced or stale - never $0, A2c/PIN1c).
   *  '0' with assetRowCount 0 = observed-empty, a real figure (PIN1a). */
  grossPricedUsd: string | null;
  /** TRUE when any asset row is unpriced or stale-priced: mandatory PARTIAL
   *  badge on gross and the "(known priced assets only)" qualifier on net
   *  (A2d/PIN2). */
  grossPartial: boolean;
  unpricedAssetCount: number;
  staleAssetCount: number;
  /** 'none' = no debt rows ("No recorded debt"); 'priced' = every debt row
   *  priced; 'partially_unknown' = ANY debt row unpriced/stale (A3). */
  debtState: 'none' | 'priced' | 'partially_unknown';
  /** Set only when debtState==='priced'. */
  recordedDebtUsd: string | null;
  /** gross - debt, present ONLY when gross is non-null AND debtState is
   *  'none' or 'priced' (A3/PIN2: unpriced debt suppresses net entirely -
   *  no partial net of known debt). May be negative (debt-only portfolio).
   *  Renders only under the explicit "Net of recorded debt" label. */
  netUsd: string | null;
  /** TRUE when net renders while gross is partial: mandatory "(known priced
   *  assets only)" qualifier - never "total net worth" (PIN2). */
  netPartial: boolean;
};

export function overviewTotals(positions: Position[]): OverviewTotals {
  const assets = positions.filter((p) => p.kind !== 'protocol_debt' && !isZero(p.amount));
  const debts = positions.filter((p) => p.kind === 'protocol_debt' && !isZero(p.amount));
  let gross = '0';
  let pricedAssets = 0;
  let unpricedAssets = 0;
  let staleAssets = 0;
  for (const p of assets) {
    if (p.price === null || p.valueUsd === null) { unpricedAssets += 1; continue; }
    if (!isPriceFresh(p)) { staleAssets += 1; continue; }
    pricedAssets += 1;
    gross = addDecimal(gross, p.valueUsd);
  }
  let debtSum = '0';
  let debtUnknown = false;
  for (const p of debts) {
    if (p.price === null || p.valueUsd === null || !isPriceFresh(p)) { debtUnknown = true; continue; }
    debtSum = addDecimal(debtSum, p.valueUsd);
  }
  const grossPricedUsd = assets.length === 0 ? '0' : pricedAssets === 0 ? null : gross;
  const grossPartial = unpricedAssets + staleAssets > 0;
  const debtState = debts.length === 0 ? 'none' : debtUnknown ? 'partially_unknown' : 'priced';
  const recordedDebtUsd = debtState === 'priced' ? debtSum : null;
  const netUsd =
    grossPricedUsd !== null && debtState !== 'partially_unknown'
      ? subDecimal(grossPricedUsd, debtState === 'priced' ? debtSum : '0')
      : null;
  return {
    assetRowCount: assets.length,
    grossPricedUsd,
    grossPartial,
    unpricedAssetCount: unpricedAssets,
    staleAssetCount: staleAssets,
    debtState,
    recordedDebtUsd,
    netUsd,
    netPartial: netUsd !== null && grossPartial,
  };
}

/** Plan 6.1 allocation: by chain and by category (spot / supplied ONLY - no
 *  invented liquidity/staking rows, A5). Shares over the SAME gross priced
 *  subtotal on both axes (A5); debt excluded from numerators and denominator.
 *  Fresh prices only - the Assets-page rule. */
export type OverviewAllocation = { byNetwork: ConcentrationRow[]; byCategory: ConcentrationRow[] };

export function overviewAllocation(positions: Position[]): OverviewAllocation {
  const fresh = positions.filter(
    (p) => p.kind !== 'protocol_debt' && !isZero(p.amount) && p.valueUsd !== null && p.price !== null && isPriceFresh(p),
  );
  const total = fresh.reduce((acc, p) => addDecimal(acc, p.valueUsd!), '0');
  const group = (key: (p: Position) => string): ConcentrationRow[] => {
    const m = new Map<string, string>();
    for (const p of fresh) m.set(key(p), addDecimal(m.get(key(p)) ?? '0', p.valueUsd!));
    return [...m.entries()]
      .map(([label, valueUsd]) => ({ label, valueUsd, sharePct: pctShare(valueUsd, total) ?? '0' }))
      .sort((a, b) => (a.valueUsd < b.valueUsd ? 1 : -1));
  };
  return {
    byNetwork: group((p) => p.network),
    byCategory: group((p) => (p.kind === 'wallet_balance' ? 'spot' : 'supplied')),
  };
}
