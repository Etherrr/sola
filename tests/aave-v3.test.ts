import { describe, expect, it } from 'vitest';
import { keccak256 } from './helpers/keccak';
import {
  SEL_GET_RESERVES_DATA,
  positionTokenAddresses,
  SEL_GET_USER_RESERVES_DATA,
  RAY,
  encodeGetReservesData,
  encodeGetUserReservesData,
  decodeGetReservesData,
  decodeGetUserReservesData,
  rayMul,
  currentSupplied,
  currentVariableDebt,
} from '../server/portfolio/aave-v3';

const sel = (sig: string) => '0x' + keccak256(sig).slice(0, 8);
const w = (n: bigint | number) => BigInt(n).toString(16).padStart(64, '0');
const aw = (a: string) => a.slice(2).padStart(64, '0');
const strTail = (s: string) => {
  const hex = Buffer.from(s, 'utf8').toString('hex');
  return w(hex.length / 2) + hex.padEnd(Math.ceil(hex.length / 64) * 64 || 0, '0');
};

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const AUSDC = '0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c';
const VDUSDC = '0x72e95b8931767c79ba4eee721354d6e99a61d004';
const AWETH = '0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8';
const VDWETH = '0xea51a78553fddf56686f8e02a1a81f51c46a64e4';
const PROVIDER = '0x2f39d218133afab8f2b819b1066c7e434ad94e9e';
const USER = '0x' + 'ab'.repeat(20);

// Independent canonical encoder for (AggregatedReserveData[], BaseCurrencyInfo).
type R = { name: string; symbol: string; asset: string; decimals: number; liq: bigint; bor: bigint; ts: bigint; aT: string; vdT: string; price: bigint };
function encReserves(rs: R[]): string {
  const heads = rs.map((r) => {
    const nameTail = strTail(r.name);
    const symbolTail = strTail(r.symbol);
    const head = [
      aw(r.asset), w(40 * 32), w(40 * 32 + nameTail.length / 2), w(r.decimals),
      w(5), w(6), w(7), w(8), w(1), w(1), w(1), w(0),
      w(r.liq), w(r.bor), w(15), w(16), w(r.ts), aw(r.aT), aw(r.vdT), w(19),
      w(20), w(21), w(r.price), w(23), w(24), w(25), w(26), w(27),
      w(0), w(0), w(30), w(31), w(1), w(33), w(34), w(35), w(36), w(1), w(38), w(39),
    ].join('');
    return head + nameTail + symbolTail;
  });
  let off = rs.length * 32;
  const offsets: string[] = [];
  for (const h of heads) { offsets.push(w(off)); off += h.length / 2; }
  const arr = w(rs.length) + offsets.join('') + heads.join('');
  return '0x' + w(0xa0) + w(10n ** 8n) + w(10n ** 8n) + w(3000n * 10n ** 8n) + w(8) + arr;
}
const RESERVES: R[] = [
  { name: 'USD Coin', symbol: 'USDC', asset: USDC, decimals: 6, liq: 1050n * 10n ** 24n, bor: 1080n * 10n ** 24n, ts: 1761000000n, aT: AUSDC, vdT: VDUSDC, price: 9999n * 10n ** 4n },
  { name: 'Wrapped Ether', symbol: 'WETH', asset: WETH, decimals: 18, liq: 1010n * 10n ** 24n, bor: 1020n * 10n ** 24n, ts: 1761000100n, aT: AWETH, vdT: VDWETH, price: 3900n * 10n ** 8n },
];

// Independent canonical encoder for (UserReserveData[], uint8).
function encUser(us: { asset: string; a: bigint; c: boolean; d: bigint }[], emode: number): string {
  const elems = us.map((u) => aw(u.asset) + w(u.a) + w(u.c ? 1 : 0) + w(u.d)).join('');
  return '0x' + w(0x40) + w(emode) + w(us.length) + elems;
}

describe('selectors are computed, not remembered', () => {
  it.each([
    ['getReservesData(address)', SEL_GET_RESERVES_DATA],
    ['getUserReservesData(address,address)', SEL_GET_USER_RESERVES_DATA],
  ])('%s', (sig, c) => expect(sel(sig)).toBe(c));
});

describe('encoders', () => {
  it('encode the provider and user words', () => {
    expect(encodeGetReservesData(PROVIDER)).toBe(SEL_GET_RESERVES_DATA + aw(PROVIDER));
    expect(encodeGetUserReservesData(PROVIDER, USER)).toBe(
      SEL_GET_USER_RESERVES_DATA + aw(PROVIDER) + aw(USER),
    );
  });
});

describe('decodeGetReservesData', () => {
  it('decodes a canonical two-reserve response', () => {
    const out = decodeGetReservesData(encReserves(RESERVES));
    expect(out).not.toBeNull();
    expect(out!.reserves.map((r) => r.symbol)).toEqual(['USDC', 'WETH']);
    expect(out!.reserves[0]!.underlyingAsset).toBe(USDC);
    expect(out!.reserves[0]!.decimals).toBe(6);
    expect(out!.reserves[0]!.liquidityIndex).toBe(1050n * 10n ** 24n);
    expect(out!.reserves[1]!.lastUpdateTimestamp).toBe(1761000100n);
    expect(out!.reserves[0]!.aTokenAddress).toBe(AUSDC);
    expect(out!.reserves[0]!.isActive).toBe(true);
    expect(out!.reserves[0]!.isFrozen).toBe(false);
    expect(out!.reserves[0]!.isPaused).toBe(false);
    expect(out!.base.marketReferenceCurrencyUnit).toBe(10n ** 8n);
    expect(out!.base.networkBaseTokenPriceDecimals).toBe(8);
  });
  it('rejects a wrong top-level offset, truncation, and a non-increasing element table', () => {
    const good = encReserves(RESERVES).slice(2);
    expect(decodeGetReservesData('0x' + w(0x80) + good.slice(64))).toBeNull();
    expect(decodeGetReservesData('0x' + good.slice(0, good.length - 64))).toBeNull();
    // Two elements pointing at the same offset (overlapping regions) are not canonical.
    const arr = w(2) + w(2 * 32) + w(2 * 32);
    expect(decodeGetReservesData('0x' + w(0xa0) + w(1) + w(2) + w(3) + w(8) + arr)).toBeNull();
  });
  it('rejects a name tail that does not start right after the head', () => {
    const r0 = { ...RESERVES[0]! };
    const one = encReserves([r0]);
    // Corrupt the name offset (head word 1 of element 0) to point past the head.
    const body = one.slice(2);
    const elemStart = (0xa0 + 32 + 1 * 32) * 2; // array: length word + one offset word
    const elemOffPos = (0xa0 + 32) * 2;
    void elemStart;
    const off = Number('0x' + body.slice(elemOffPos, elemOffPos + 64));
    const nameOffPos = (0xa0 + 32 + 32 + off) * 2 + 64; // element start + word 1
    const corrupt = body.slice(0, nameOffPos) + w(41 * 32) + body.slice(nameOffPos + 64);
    expect(decodeGetReservesData('0x' + corrupt)).toBeNull();
  });
});

describe('signed BaseCurrencyInfo handling', () => {
  const withBase = (unit: bigint, refPrice: bigint, netPrice: bigint, netDec: bigint) =>
    '0x' + w(0xa0) + w(unit) + w(refPrice) + w(netPrice) + w(netDec) + encReserves(RESERVES).slice(2 + 64 + 4 * 64);
  it('rejects a negative reference price (int256) instead of reading it as huge unsigned', () => {
    // -1 as int256 is 0xff..ff; an unsigned read would be ~1.15e77.
    const neg1 = (1n << 256n) - 1n;
    expect(decodeGetReservesData(withBase(10n ** 8n, neg1, 3000n * 10n ** 8n, 8n))).toBeNull();
    expect(decodeGetReservesData(withBase(10n ** 8n, 10n ** 8n, neg1, 8n))).toBeNull();
  });
  it('rejects zero and absurd positive prices and a zero currency unit', () => {
    expect(decodeGetReservesData(withBase(10n ** 8n, 0n, 3000n * 10n ** 8n, 8n))).toBeNull();
    expect(decodeGetReservesData(withBase(10n ** 8n, 10n ** 8n * 10n ** 16n, 3000n * 10n ** 8n, 8n))).toBeNull();
    expect(decodeGetReservesData(withBase(0n, 10n ** 8n, 3000n * 10n ** 8n, 8n))).toBeNull();
  });
});

describe('receipt and debt token exclusion', () => {
  it('exposes every aToken and variable-debt token, never the underlying assets', () => {
    const out = decodeGetReservesData(encReserves(RESERVES));
    const excluded = positionTokenAddresses(out!.reserves);
    expect(excluded).toEqual(new Set([AUSDC, VDUSDC, AWETH, VDWETH]));
    expect(excluded.has(USDC)).toBe(false);
    expect(excluded.has(WETH)).toBe(false);
  });
});

describe('decodeGetUserReservesData', () => {
  it('decodes a canonical response with eMode', () => {
    const out = decodeGetUserReservesData(
      encUser([{ asset: USDC, a: 5n * 10n ** 6n, c: true, d: 2n * 10n ** 6n }, { asset: WETH, a: 0n, c: false, d: 10n ** 17n }], 0),
    );
    expect(out).not.toBeNull();
    expect(out!.eMode).toBe(0);
    expect(out!.userReserves[0]).toEqual({
      underlyingAsset: USDC, scaledATokenBalance: 5n * 10n ** 6n,
      usageAsCollateralEnabled: true, scaledVariableDebt: 2n * 10n ** 6n,
    });
    expect(out!.userReserves[1]!.scaledATokenBalance).toBe(0n);
  });
  it('rejects a truncated payload and a non-boolean collateral flag', () => {
    const good = encUser([{ asset: USDC, a: 1n, c: true, d: 0n }], 0);
    expect(decodeGetUserReservesData(good.slice(0, -64))).toBeNull();
    const bad = encUser([{ asset: USDC, a: 1n, c: true, d: 0n }], 0).slice(2);
    const collatPos = (0x40 + 32 + 2 * 32) * 2; // first element, third word
    const corrupt = bad.slice(0, collatPos) + w(7) + bad.slice(collatPos + 64);
    expect(decodeGetUserReservesData('0x' + corrupt)).toBeNull();
  });
});

describe('ray math', () => {
  it('matches Aave rayMul semantics, including half-up rounding', () => {
    expect(rayMul(2n * RAY, 3n * RAY)).toBe(6n * RAY);
    expect(rayMul(0n, RAY)).toBe(0n);
    expect(rayMul(1n, RAY)).toBe(1n);
    // 3 x floor(RAY/3) = RAY - 1, so the product is one wei short of RAY after division.
    const third = RAY / 3n;
    expect(rayMul(3n, third)).toBe(1n);
    expect(rayMul(third, third)).toBe(RAY / 9n);
  });
  it('derives current balances from scaled balances and stored indexes', () => {
    expect(currentSupplied(1000n * 10n ** 6n, 1050n * 10n ** 24n)).toBe(1050n * 10n ** 6n);
    expect(currentVariableDebt(10n ** 18n, 1020n * 10n ** 24n)).toBe(102n * 10n ** 16n);
  });
});
