/**
 * Read-only Aave V3 position decoding (UiPoolDataProviderV3).
 * Scope: supplied (aToken) balances and variable-debt balances per reserve. No stable-debt
 * read exists in this interface, so callers must never describe the result as all debt.
 * Two dynamic-shape rules mirror abi.ts: never trust an offset or length that has not been
 * bounds-checked, and reject anything but canonical, sequential, non-overlapping layout.
 * All math is bigint; balances derive as scaled x index with Aave's own rayMul rounding,
 * observed as of each reserve's stored lastUpdateTimestamp (the index is not projected).
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
  const base: BaseCurrencyInfo = {
    marketReferenceCurrencyUnit: r.word(0x20) ?? -1n,
    marketReferenceCurrencyPriceInUsd: r.word(0x40) ?? -1n,
    networkBaseTokenPriceInUsd: r.word(0x60) ?? -1n,
    networkBaseTokenPriceDecimals: Number(r.word(0x80) ?? -1n),
  };
  if (base.marketReferenceCurrencyUnit < 0n || base.networkBaseTokenPriceDecimals < 0) return null;
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
