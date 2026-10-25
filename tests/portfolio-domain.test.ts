import { describe, it, expect } from 'vitest';
import {
  addDecimal,
  subDecimal,
  divDecimal,
  amountToRaw,
  isZero,
  fromWalletResult,
  dedupePositions,
  netProtocolAmount,
  summarize,
  isPriceFresh,
  PRICE_MAX_SKEW_MS,
  type Position,
} from '../server/portfolio/domain';
import type { WalletResult } from '../server/portfolio/contract';

describe('exact decimal arithmetic', () => {
  it('adds and subtracts signed decimals exactly, negatives stay negative', () => {
    expect(addDecimal('1.005', '2.995')).toBe('4');
    expect(addDecimal('0.1', '0.2')).toBe('0.3');
    expect(subDecimal('100', '130')).toBe('-30');
    expect(subDecimal('-5', '2.5')).toBe('-7.5');
    expect(addDecimal('12345678901234567890.123456789', '0.000000001')).toBe('12345678901234567890.12345679');
    expect(isZero('0')).toBe(true);
    expect(isZero('-0.0')).toBe(true);
    expect(isZero('0.0001')).toBe(false);
  });
  it('divides truncated to 8dp', () => {
    expect(divDecimal('200', '100')).toBe('2');
    expect(divDecimal('1', '3')).toBe('0.33333333');
    expect(() => divDecimal('-1', '2')).toThrow();
  });
  it('converts normalized amounts to raw units exactly', () => {
    expect(amountToRaw('1.5', 18)).toBe(1500000000000000000n);
    expect(() => amountToRaw('0.0000000000000000001', 18)).toThrow();
  });
});

const NOW = '2026-10-25T12:00:00.000Z';
const FRESH_PRICE_AT = '2026-10-25T11:50:00.000Z';
const STALE_PRICE_AT = '2026-10-25T10:00:00.000Z';

const wallet: WalletResult = {
  address: '0xABC',
  partial: false,
  warnings: [],
  assets: [
    {
      assetId: 'eip155:1/native',
      symbol: 'ETH',
      decimals: 18,
      rawAmount: '1500000000000000000',
      amount: '1.5',
      price: '2000',
      value: '3000',
      priceSource: 'chainlink',
      priceObservedAt: FRESH_PRICE_AT,
    },
    {
      assetId: 'eip155:1/erc20:0xTOKEN',
      symbol: 'TKN',
      decimals: 6,
      rawAmount: '5000000',
      amount: '5',
      price: null,
      value: null,
      priceSource: null,
      priceObservedAt: null,
    },
  ],
  aave: {
    status: 'ok',
    positions: [
      {
        underlyingAsset: '0xWETH',
        symbol: 'WETH',
        decimals: 18,
        supplied: '2',
        variableDebt: '2.5',
        suppliedValueUsd: '4000',
        variableDebtValueUsd: '5000',
        priceSource: 'chainlink',
        priceObservedAt: FRESH_PRICE_AT,
        observedAt: NOW,
        usageAsCollateralEnabled: true,
        reserveNote: null,
      },
    ],
  },
};

describe('fromWalletResult', () => {
  it('maps wallet balances and protocol positions into one model, zero sides omitted', () => {
    const pos = fromWalletResult('ethereum', wallet, NOW);
    expect(pos.filter((p) => p.kind === 'wallet_balance')).toHaveLength(2);
    expect(pos.filter((p) => p.kind === 'protocol_supplied')).toHaveLength(1);
    expect(pos.filter((p) => p.kind === 'protocol_debt')).toHaveLength(1);
    const supplied = pos.find((p) => p.kind === 'protocol_supplied')!;
    expect(supplied.protocol).toBe('aave-v3');
    expect(supplied.valueUsd).toBe('4000'); // provider's own value preserved
    expect(supplied.price!.usd).toBe('2000'); // derived value/amount
    const unpriced = pos.find((p) => p.asset.symbol === 'TKN')!;
    expect(unpriced.valueUsd).toBeNull();
    expect(unpriced.price).toBeNull();
  });
  it('aave unavailable adds nothing and fabricates no positions', () => {
    const w: WalletResult = { ...wallet, aave: { status: 'unavailable', reason: 'timeout' } };
    expect(fromWalletResult('ethereum', w, NOW).filter((p) => p.protocol !== null)).toHaveLength(0);
  });
});

describe('dedupe', () => {
  const row = (amount: string, value: string | null, pxAt = FRESH_PRICE_AT): Position => ({
    kind: 'wallet_balance',
    asset: { assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18 },
    network: 'ethereum',
    address: '0xABC',
    amount,
    price: { usd: '2000', source: 'chainlink', observedAt: pxAt },
    valueUsd: value,
    source: 'chainlink',
    observedAt: NOW,
    protocol: null,
  });
  it('sums duplicate amounts and recomputes the value from the SUM, not rounded parts', () => {
    const [d] = dedupePositions([row('0.333333333333333333', '666.666666'), row('0.333333333333333334', '666.666668')]);
    expect(d.amount).toBe('0.666666666666666667');
    expect(d.valueUsd).toBe('1333.333333'); // exact sum x price, truncated at 6dp (valueUsd contract)
  });
  it('does not touch the provider value of an unmerged row', () => {
    const [d] = dedupePositions([row('1.5', '3000')]);
    expect(d.valueUsd).toBe('3000');
  });
});

describe('staleness, netting and subtotals', () => {
  const pos = fromWalletResult('ethereum', wallet, NOW);
  it('an OLD quote against a FRESH balance reads stale (real teeth, reviewer 2026-10-25)', () => {
    const freshBalOldQuote: Position = {
      kind: 'wallet_balance',
      asset: { assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18 },
      network: 'ethereum',
      address: '0xABC',
      amount: '1.5',
      price: { usd: '2000', source: 'chainlink', observedAt: STALE_PRICE_AT },
      valueUsd: '3000',
      source: 'chainlink',
      observedAt: NOW, // fresh balance, stale quote
      protocol: null,
    };
    expect(isPriceFresh(freshBalOldQuote)).toBe(false);
    const s = summarize([freshBalOldQuote]);
    expect(s.netPricedUsd).toBe('0'); // excluded from the subtotal
    expect(s.stalePriceCount).toBe(1);
  });
  it('Solana addresses match EXACTLY in netting; EVM matches case-insensitively', () => {
    const SOL_A = 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB';
    const solRows: Position[] = [{
      kind: 'protocol_supplied',
      asset: { assetId: 'solana/native', symbol: 'SOL', decimals: 9 },
      network: 'solana',
      address: SOL_A,
      amount: '10',
      price: null,
      valueUsd: null,
      source: 'provider',
      observedAt: NOW,
      protocol: 'marinade',
    }];
    // exact match nets
    expect(netProtocolAmount(solRows, 'marinade', 'solana', SOL_A, 'solana/native')).toBe('10');
    // case-variant does NOT match (base58 is case-sensitive)
    expect(netProtocolAmount(solRows, 'marinade', 'solana', SOL_A.toLowerCase(), 'solana/native')).toBe('0');
    // EVM variant matches
    const evmRows: Position[] = [{ ...solRows[0]!, network: 'ethereum', address: '0xAbC', asset: { assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18 }, protocol: 'aave-v3' }];
    expect(netProtocolAmount(evmRows, 'aave-v3', 'ethereum', '0xabc', 'eip155:1/native')).toBe('10');
  });
  it('price freshness is deterministic within the skew window', () => {
    const fresh = pos.find((p) => p.asset.symbol === 'ETH')!;
    expect(isPriceFresh(fresh)).toBe(true);
    const stale: Position = { ...fresh, price: { ...fresh.price!, observedAt: STALE_PRICE_AT } };
    expect(isPriceFresh(stale)).toBe(false);
    expect(Date.parse(FRESH_PRICE_AT) > Date.parse(NOW) - PRICE_MAX_SKEW_MS).toBe(true);
  });
  it('netting is signed and never clamped: 2 supplied - 2.5 debt = -0.5', () => {
    expect(netProtocolAmount(pos, 'aave-v3', 'ethereum', '0xabc', 'eip155:1/erc20:0xWETH')).toBe('-0.5');
  });
  it('summary: unpriced never zero-valued; debt subtracted once; subtotal labeled partial', () => {
    const s = summarize(pos);
    expect(s.spotPricedUsd).toBe('3000');
    expect(s.suppliedPricedUsd).toBe('4000');
    expect(s.debtPricedUsd).toBe('5000');
    expect(s.netPricedUsd).toBe('2000'); // 3000+4000-5000
    expect(s.unpricedCount).toBe(1); // TKN counted, not zeroed
    expect(s.coverage).toBe('partial');
  });
  it('stale prices are excluded from the subtotal, never treated as fresh', () => {
    const staleAll = pos.map((p) =>
      p.price ? { ...p, price: { ...p.price, observedAt: STALE_PRICE_AT } } : p);
    const s = summarize(staleAll);
    expect(s.netPricedUsd).toBe('0');
    expect(s.stalePriceCount).toBe(3);
    expect(s.coverage).toBe('partial');
  });
  it('a negative net subtotal stays negative', () => {
    const onlyDebt = pos.filter((p) => p.kind === 'protocol_debt');
    expect(summarize(onlyDebt).netPricedUsd).toBe('-5000');
  });
});
