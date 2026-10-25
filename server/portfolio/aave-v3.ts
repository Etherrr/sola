/**
 * Read-only Aave V3 position decoding (UiPoolDataProviderV3).
 * Scope: supplied (aToken) balances and variable-debt balances per reserve. No stable-debt
 * read exists in this interface, so callers must never describe the result as all debt.
 * Two dynamic-shape rules mirror abi.ts: never trust an offset or length that has not been
 * bounds-checked, and reject anything but canonical, sequential, non-overlapping layout.
 * All math is bigint; balances derive as scaled x index with Aave's own rayMul rounding,
 * observed as of each reserve's stored lastUpdateTimestamp (the index is not projected);
 * consumers must render that as the stored-index observation time, never as 'current now'.
 */
import { addressWord } from './abi';

export const SEL_GET_RESERVES_DATA = '0xec489c21';
export const SEL_GET_USER_RESERVES_DATA = '0x51974cc0';

export const RAY = 10n ** 27n;

export function encodeGetReservesData(provider: string): string {
  return SEL_GET_RESERVES_DATA + addressWord(provider);
}
export function encodeGetUserReservesData(provider: string, user: string): string {
  return SEL_GET_USER_RESERVES_DATA + addressWord(provider) + addressWord(user);
}

export type ReserveData = {
  underlyingAsset: string;
  symbol: string;
  decimals: number;
  isActive: boolean;
  isFrozen: boolean;
  isPaused: boolean;
  liquidityIndex: bigint;
  variableBorrowIndex: bigint;
  lastUpdateTimestamp: bigint;
  aTokenAddress: string;
  variableDebtTokenAddress: string;
  priceInMarketReferenceCurrency: bigint;
};

export type BaseCurrencyInfo = {
  marketReferenceCurrencyUnit: bigint;
  marketReferenceCurrencyPriceInUsd: bigint;
  networkBaseTokenPriceInUsd: bigint;
  networkBaseTokenPriceDecimals: number;
};

export type UserReserve = {
  underlyingAsset: string;
  scaledATokenBalance: bigint;
  usageAsCollateralEnabled: boolean;
  scaledVariableDebt: bigint;
};

const HEAD_WORDS = 40; // AggregatedReserveData head size, per the canonical v3-origin interface.

class Reader {
  private body: string;
  readonly size: number;
  constructor(hex: string) {
    this.body = hex.slice(2);
    this.size = this.body.length / 2;
  }
  word(byteOff: number): bigint | null {
    if (!Number.isInteger(byteOff) || byteOff < 0 || byteOff + 32 > this.size) return null;
    return BigInt('0x' + this.body.slice(byteOff * 2, (byteOff + 32) * 2));
  }
  /** int256 two's-complement decode for signed fields. */
  signedWord(byteOff: number): bigint | null {
    const v = this.word(byteOff);
    if (v === null) return null;
    return v >= 1n << 255n ? v - (1n << 256n) : v;
  }
  addr(byteOff: number): string | null {
    const v = this.word(byteOff);
    if (v === null || v >= 1n << 160n) return null;
    return '0x' + v.toString(16).padStart(40, '0');
  }
  /** Canonical ABI string tail: length word plus padded data, fully inside [limit). */
  str(byteOff: number, limit: number): { value: string; end: number } | null {
    const n = this.word(byteOff);
    if (n === null || n > 256n) return null; // symbols and names are short; a huge length is not a string
    const len = Number(n);
    const dataStart = byteOff + 32;
    const padded = Math.ceil(len / 32) * 32 || 0;
    const end = dataStart + (len === 0 ? 0 : padded);
    if (dataStart + len > this.size || end > limit) return null;
    const raw = this.body.slice(dataStart * 2, (dataStart + len) * 2);
    if (!/^[\x20-\x7e]*$/.test(Buffer.from(raw, 'hex').toString('utf8'))) return null;
    return { value: Buffer.from(raw, 'hex').toString('utf8'), end };
  }
}

/** Decodes (AggregatedReserveData[], BaseCurrencyInfo). Null for anything non-canonical. */
export function decodeGetReservesData(
  hex: string,
): { reserves: ReserveData[]; base: BaseCurrencyInfo } | null {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) return null;
  const r = new Reader(hex);
  const arrOff = r.word(0);
  if (arrOff === null || arrOff !== 0xa0n) return null; // 1 offset word + 4 static BaseCurrencyInfo words
  // The two price fields are int256 in the interface: decode them signed, and reject
  // nonpositive or absurd values rather than letting a negative become a huge unsigned.
  const unit = r.word(0x20);
  const refPrice = r.signedWord(0x40);
  const netPrice = r.signedWord(0x60);
  const netDecimals = r.word(0x80);
  const PRICE_BOUND = 10n ** 8n * 10n ** 15n; // 8 decimals x $10^15: far above any real feed
  if (
    unit === null || unit <= 0n || unit > 10n ** 36n ||
    refPrice === null || refPrice <= 0n || refPrice > PRICE_BOUND ||
    netPrice === null || netPrice <= 0n || netPrice > PRICE_BOUND ||
    netDecimals === null || netDecimals > 77n
  ) return null;
  const base: BaseCurrencyInfo = {
    marketReferenceCurrencyUnit: unit,
    marketReferenceCurrencyPriceInUsd: refPrice,
    networkBaseTokenPriceInUsd: netPrice,
    networkBaseTokenPriceDecimals: Number(netDecimals),
  };
  const n = r.word(Number(arrOff));
  if (n === null || n > 512n) return null;
  const count = Number(n);
  const tableStart = Number(arrOff) + 32;
  const elemOffsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const o = r.word(tableStart + i * 32);
    if (o === null || o % 32n !== 0n) return null;
    elemOffsets.push(tableStart + Number(o));
  }
  // Canonical layout: strictly increasing element offsets, each head fully inside the payload.
  for (let i = 0; i < count; i++) {
    if (elemOffsets[i]! < tableStart + count * 32) return null;
    if (i > 0 && elemOffsets[i]! <= elemOffsets[i - 1]!) return null;
    if (elemOffsets[i]! + HEAD_WORDS * 32 > r.size) return null;
  }
  const reserves: ReserveData[] = [];
  for (let i = 0; i < count; i++) {
    const start = elemOffsets[i]!;
    const limit = i + 1 < count ? elemOffsets[i + 1]! : r.size;
    const head = (k: number) => r.word(start + k * 32);
    const addrAt = (k: number) => r.addr(start + k * 32);
    const underlyingAsset = addrAt(0);
    const nameOff = head(1);
    const symbolOff = head(2);
    if (underlyingAsset === null || nameOff === null || symbolOff === null) return null;
    // Canonical layout: the name tail starts right after the head, the symbol tail right
    // after the name tail, both fully inside this element's region. No gaps, no overlap.
    if (nameOff !== BigInt(HEAD_WORDS * 32)) return null;
    const name = r.str(start + Number(nameOff), limit);
    if (name === null) return null;
    if (symbolOff !== BigInt(name.end - start)) return null;
    const symbol = r.str(start + Number(symbolOff), limit);
    if (symbol === null) return null;
    const decimals = head(3);
    const liquidityIndex = head(12);
    const variableBorrowIndex = head(13);
    const lastUpdateTimestamp = head(16);
    const aTokenAddress = addrAt(17);
    const variableDebtTokenAddress = addrAt(18);
    const priceInMarketReferenceCurrency = head(22);
    if (
      decimals === null || decimals > 77n ||
      liquidityIndex === null || variableBorrowIndex === null ||
      lastUpdateTimestamp === null || aTokenAddress === null ||
      variableDebtTokenAddress === null || priceInMarketReferenceCurrency === null
    ) return null;
    reserves.push({
      underlyingAsset,
      symbol: symbol.value,
      decimals: Number(decimals),
      isActive: head(10) === 1n,
      isFrozen: head(11) === 1n,
      isPaused: head(28) === 1n,
      liquidityIndex,
      variableBorrowIndex,
      lastUpdateTimestamp,
      aTokenAddress,
      variableDebtTokenAddress,
      priceInMarketReferenceCurrency,
    });
  }
  return { reserves, base };
}

/** Decodes (UserReserveData[], uint8). Null for anything non-canonical. */
export function decodeGetUserReservesData(
  hex: string,
): { userReserves: UserReserve[]; eMode: number } | null {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) return null;
  const r = new Reader(hex);
  const arrOff = r.word(0);
  if (arrOff === null || arrOff !== 0x40n) return null; // 1 offset word + 1 static eMode word
  const em = r.word(0x20);
  if (em === null || em > 255n) return null;
  const n = r.word(Number(arrOff));
  if (n === null || n > 512n) return null;
  const count = Number(n);
  const elemsStart = Number(arrOff) + 32;
  if (elemsStart + count * 4 * 32 > r.size) return null;
  const userReserves: UserReserve[] = [];
  for (let i = 0; i < count; i++) {
    const start = elemsStart + i * 4 * 32;
    const underlyingAsset = r.addr(start);
    const scaledATokenBalance = r.word(start + 32);
    const collat = r.word(start + 64);
    const scaledVariableDebt = r.word(start + 96);
    if (underlyingAsset === null || scaledATokenBalance === null || scaledVariableDebt === null)
      return null;
    if (collat !== 0n && collat !== 1n) return null;
    userReserves.push({
      underlyingAsset,
      scaledATokenBalance,
      usageAsCollateralEnabled: collat === 1n,
      scaledVariableDebt,
    });
  }
  return { userReserves, eMode: Number(em) };
}

/** Receipt (aToken) and variable-debt token addresses per reserve. Aggregation must exclude
 *  every one of these from any asset list: a receipt token is the position, not a second asset. */
export function positionTokenAddresses(reserves: ReserveData[]): Set<string> {
  const out = new Set<string>();
  for (const r of reserves) {
    out.add(r.aTokenAddress);
    out.add(r.variableDebtTokenAddress);
  }
  return out;
}

/** Aave WadRayMath.rayMul: (a * b + RAY / 2) / RAY, bigint only. */
export function rayMul(a: bigint, b: bigint): bigint {
  if (a < 0n || b < 0n) throw new RangeError('rayMul is unsigned');
  if (a === 0n || b === 0n) return 0n;
  return (a * b + RAY / 2n) / RAY;
}

/** Current supplied balance from a scaled aToken balance and the reserve's stored liquidity index. */
export function currentSupplied(scaledATokenBalance: bigint, liquidityIndex: bigint): bigint {
  return rayMul(scaledATokenBalance, liquidityIndex);
}

/** Current variable-debt balance from a scaled debt balance and the reserve's stored borrow index. */
export function currentVariableDebt(scaledVariableDebt: bigint, variableBorrowIndex: bigint): bigint {
  return rayMul(scaledVariableDebt, variableBorrowIndex);
}
