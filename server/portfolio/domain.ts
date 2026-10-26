/**
 * Normalized portfolio domain (plan Phase C.1). ONE position model for wallet
 * balances and protocol positions across chains; every figure is a decimal
 * string or bigint - no floating point anywhere.
 *
 * Invariants (architecture §7 advisory + plan §6):
 * - A Supplied asset is a protocol position, never an additional wallet balance;
 *   debt is a separate position kind and is subtracted exactly once.
 * - Netting is signed: supplied - debt MAY go negative and stays negative.
 * - A price is FRESH only inside the skew window vs the balance observation;
 *   a stale price is never treated as fresh and never zeroed - it is excluded
 *   from the priced subtotal and flagged.
 * - Unpriced positions are never zero-valued: they carry valueUsd=null and are
 *   counted, not silently dropped.
 * - The priced figure is a SUBTOTAL of recognized positions, not a lower bound
 *   and not a claim of total portfolio value.
 */
import { valueUsd } from './units';
import type { WalletResult } from './contract';

export type Network = 'ethereum' | 'solana';

export type AssetRef = { assetId: string; symbol: string; decimals: number };

export type PricePoint = {
  usd: string; // decimal string, USD per whole token
  source: string;
  observedAt: string; // price observation time (ISO-8601)
};

export type PositionKind = 'wallet_balance' | 'protocol_supplied' | 'protocol_debt';

export type Position = {
  kind: PositionKind;
  asset: AssetRef;
  network: Network;
  address: string;
  /** Normalized decimal-string amount. */
  amount: string;
  price: PricePoint | null;
  /** amount x price when priced; null when unpriced - never '0' for unknown. */
  valueUsd: string | null;
  source: string;
  /** Balance/position observation time (ISO-8601). */
  observedAt: string;
  protocol: string | null;
};

/** A price older than this skew vs the balance observation is STALE. */
export const PRICE_MAX_SKEW_MS = 15 * 60 * 1000;

/* ---------- exact signed decimal arithmetic (string <-> bigint) ---------- */

const DEC_RE = /^-?\d+(\.\d+)?$/;
export const isDecimal = (v: unknown): v is string => typeof v === 'string' && DEC_RE.test(v);

function splitDec(s: string): { neg: boolean; digits: string; fracLen: number } {
  if (!DEC_RE.test(s)) throw new RangeError(`bad decimal: ${s}`);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [whole, frac = ''] = body.split('.');
  return { neg, digits: whole + frac, fracLen: frac.length };
}

function renderScaled(v: bigint, fracLen: number): string {
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(fracLen + 1, '0');
  const whole = s.slice(0, s.length - fracLen);
  const frac = fracLen > 0 ? s.slice(s.length - fracLen).replace(/0+$/, '') : '';
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** Exact signed a + b on decimal strings. */
export function addDecimal(a: string, b: string): string {
  const x = splitDec(a);
  const y = splitDec(b);
  const f = Math.max(x.fracLen, y.fracLen);
  const xi = BigInt(x.digits) * 10n ** BigInt(f - x.fracLen) * (x.neg ? -1n : 1n);
  const yi = BigInt(y.digits) * 10n ** BigInt(f - y.fracLen) * (y.neg ? -1n : 1n);
  return renderScaled(xi + yi, f);
}

/** Exact signed a - b on decimal strings; may return a negative value. */
export const subDecimal = (a: string, b: string): string =>
  addDecimal(a, b.startsWith('-') ? b.slice(1) : '-' + b);

export const isZero = (s: string): boolean => DEC_RE.test(s) && BigInt(s.replace('-', '').replace('.', '') || '0') === 0n;

/** Exact a / b truncated to 8 fractional digits (positive decimals only). */
/** Exact a x b for decimal strings, truncated to 6 fractional digits (the
 *  same truncation units.valueUsd applies). Used on the RECORDED read path
 *  where amounts are already normalized decimals - no raw/decimals math. */
export function mulDecimal(a: string, b: string): string {
  const x = splitDec(a);
  const y = splitDec(b);
  const neg = x.neg !== y.neg;
  const digits = (BigInt(x.digits) * BigInt(y.digits)).toString();
  const scale = x.fracLen + y.fracLen;
  const padded = digits.padStart(scale + 1, '0');
  const whole = scale ? padded.slice(0, padded.length - scale) : padded;
  const frac = scale ? padded.slice(padded.length - scale) : '';
  const f6 = frac.slice(0, 6).replace(/0+$/, '');
  const zero = isZero(whole + (f6 ? '.' + f6 : ''));
  return `${neg && !zero ? '-' : ''}${whole || '0'}${f6 ? '.' + f6 : ''}`;
}

export function divDecimal(a: string, b: string): string {
  const x = splitDec(a);
  const y = splitDec(b);
  if (x.neg || y.neg) throw new RangeError('divDecimal is unsigned');
  // (x / 10^xf) / (y / 10^yf) * 10^8 = x * 10^(8 + yf) / (y * 10^xf)
  const scaled = (BigInt(x.digits) * 10n ** BigInt(8 + y.fracLen)) / (BigInt(y.digits) * 10n ** BigInt(x.fracLen));
  return renderScaled(scaled, 8);
}

/** Normalized amount -> raw integer units. Throws when the amount carries more
 *  fractional digits than the asset supports (that would be a provider bug). */
export function amountToRaw(amount: string, decimals: number): bigint {
  const { neg, digits, fracLen } = splitDec(amount);
  if (fracLen > decimals) throw new RangeError('amount has more precision than the asset');
  const v = BigInt(digits) * 10n ** BigInt(decimals - fracLen);
  return neg ? -v : v;
}

/* ---------- mapping from provider results ---------- */

/** Chain-aware address key: EVM compares case-insensitively, Solana base58 is
 *  EXACT (case-sensitive alphabet). Never lowercase Solana in identity, netting
 *  or reconciliation paths (reviewer 2026-10-25). */
export const addressKey = (network: Network, address: string): string =>
  network === 'ethereum' ? address.toLowerCase() : address;

/** One wallet's provider result -> normalized positions. Zero-value sides of a
 *  protocol position are omitted (a '0' side is a true zero per the contract,
 *  not a position). `balanceObservedAt` is the PROVIDER's balance observation
 *  (ResolveResponse.observedAt) - NOT the price time, so the stale-price policy
 *  has real teeth (an old quote against a fresh balance reads stale). */
export function fromWalletResult(network: Network, w: WalletResult, balanceObservedAt: string): Position[] {
  const out: Position[] = [];
  for (const a of w.assets) {
    const price: PricePoint | null =
      a.price !== null && a.priceSource !== null && a.priceObservedAt !== null
        ? { usd: a.price, source: a.priceSource, observedAt: a.priceObservedAt }
        : null;
    out.push({
      kind: 'wallet_balance',
      asset: { assetId: a.assetId, symbol: a.symbol, decimals: a.decimals },
      network,
      address: w.address,
      amount: a.amount,
      price,
      valueUsd: a.value,
      source: a.priceSource ?? 'provider',
      observedAt: balanceObservedAt,
      protocol: null,
    });
  }
  if (w.aave?.status === 'ok') {
    for (const p of w.aave.positions) {
      const base = {
        asset: { assetId: `eip155:1/erc20:${p.underlyingAsset}`, symbol: p.symbol, decimals: p.decimals },
        network: 'ethereum' as const,
        address: w.address,
        source: p.priceSource ?? 'aave-v3',
        observedAt: p.observedAt,
        protocol: 'aave-v3',
      };
      // The contract carries verified VALUES, not a unit price. Derive the unit
      // price (value/amount, 8dp) solely so merged rows can be re-valued; the
      // provider's own value string is what unmerged positions keep.
      const derive = (amount: string, value: string | null): PricePoint | null => {
        if (p.priceSource === null || p.priceObservedAt === null || value === null || isZero(amount)) return null;
        try {
          return {
            usd: divDecimal(value, amount),
            source: p.priceSource,
            observedAt: p.priceObservedAt,
          };
        } catch {
          return null;
        }
      };
      if (!isZero(p.supplied))
        out.push({ ...base, kind: 'protocol_supplied', amount: p.supplied, price: derive(p.supplied, p.suppliedValueUsd), valueUsd: p.suppliedValueUsd });
      if (!isZero(p.variableDebt))
        out.push({ ...base, kind: 'protocol_debt', amount: p.variableDebt, price: derive(p.variableDebt, p.variableDebtValueUsd), valueUsd: p.variableDebtValueUsd });
    }
  }
  return out;
}

/* ---------- dedupe ---------- */

const posKey = (p: Position): string =>
  [p.kind, p.asset.assetId, p.network, addressKey(p.network, p.address), p.protocol ?? ''].join('|');

/** Merge duplicate rows (same kind+asset+network+address+protocol): amounts are
 *  summed exactly, the freshest price wins, and the value is recomputed from
 *  the summed amount - never a sum of independently rounded values. */
export function dedupePositions(positions: Position[]): Position[] {
  const byKey = new Map<string, Position>();
  const merged = new Set<string>();
  for (const p of positions) {
    const k = posKey(p);
    const cur = byKey.get(k);
    if (!cur) {
      byKey.set(k, { ...p });
      continue;
    }
    cur.amount = addDecimal(cur.amount, p.amount);
    if (p.observedAt > cur.observedAt) cur.observedAt = p.observedAt;
    if (p.price && (!cur.price || p.price.observedAt > cur.price.observedAt)) cur.price = p.price;
    merged.add(k);
  }
  for (const [k, p] of byKey) {
    if (!merged.has(k)) continue; // single row: keep the provider's own value
    p.valueUsd = null; // recomputed below
    if (p.price) {
      try {
        p.valueUsd = valueUsd(amountToRaw(p.amount, p.asset.decimals), p.asset.decimals, p.price.usd);
      } catch {
        p.valueUsd = null; // bad price/amount shape -> treat as unpriced, never zero
      }
    }
  }
  return [...byKey.values()];
}

/* ---------- staleness ---------- */

/** Deterministic stale policy: fresh only when BOTH times exist and the price is
 *  not older than the balance observation by more than PRICE_MAX_SKEW_MS. */
export function isPriceFresh(p: Position): boolean {
  if (!p.price || !p.observedAt) return false;
  const bal = Date.parse(p.observedAt);
  const px = Date.parse(p.price.observedAt);
  if (Number.isNaN(bal) || Number.isNaN(px)) return false;
  return bal - px <= PRICE_MAX_SKEW_MS;
}

/* ---------- netting and subtotals ---------- */

/** Signed net of one protocol position family: supplied - debt (negative stays
 *  negative; a leveraged/underwater position is not clamped to zero). */
export function netProtocolAmount(positions: Position[], protocol: string, network: Network, address: string, assetId: string): string {
  let supplied = '0';
  let debt = '0';
  for (const p of positions) {
    if (p.protocol !== protocol || p.network !== network || p.asset.assetId !== assetId) continue;
    if (addressKey(p.network, p.address) !== addressKey(network, address)) continue;
    if (p.kind === 'protocol_supplied') supplied = addDecimal(supplied, p.amount);
    if (p.kind === 'protocol_debt') debt = addDecimal(debt, p.amount);
  }
  return subDecimal(supplied, debt);
}

export type PortfolioSummary = {
  /** Priced wallet balances (fresh prices only). */
  spotPricedUsd: string;
  /** Priced protocol-supplied value (fresh prices only). */
  suppliedPricedUsd: string;
  /** Priced protocol debt (fresh prices only). */
  debtPricedUsd: string;
  /** spot + supplied - debt. A SUBTOTAL of recognized positions, not a total
   *  portfolio value and not a lower bound. May be negative. */
  netPricedUsd: string;
  /** Positions without a usable price - counted, never zero-valued. */
  unpricedCount: number;
  /** Priced positions whose price is stale (excluded from the subtotals). */
  stalePriceCount: number;
  coverage: 'full' | 'partial';
};

export function summarize(positions: Position[]): PortfolioSummary {
  let spot = '0';
  let supplied = '0';
  let debt = '0';
  let unpriced = 0;
  let stale = 0;
  for (const p of positions) {
    if (isZero(p.amount)) continue;
    if (!p.price || p.valueUsd === null) {
      unpriced += 1;
      continue;
    }
    if (!isPriceFresh(p)) {
      stale += 1;
      continue;
    }
    if (p.kind === 'wallet_balance') spot = addDecimal(spot, p.valueUsd);
    else if (p.kind === 'protocol_supplied') supplied = addDecimal(supplied, p.valueUsd);
    else debt = addDecimal(debt, p.valueUsd);
  }
  return {
    spotPricedUsd: spot,
    suppliedPricedUsd: supplied,
    debtPricedUsd: debt,
    netPricedUsd: subDecimal(addDecimal(spot, supplied), debt),
    unpricedCount: unpriced,
    stalePriceCount: stale,
    coverage: unpriced > 0 || stale > 0 ? 'partial' : 'full',
  };
}
