import { describe, expect, it } from 'vitest';
import { aaveToPositions, usdToCents } from '../features/portfolio/aave-model';
import { summarize, uniqueExposures, assetAllocation } from '../features/portfolio/model';
import type { ApiAavePosition } from '../features/portfolio/api-client';

const WALLET = '0x' + 'ab'.repeat(20);
const pos = (over: Partial<ApiAavePosition>): ApiAavePosition => ({
  underlyingAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  symbol: 'USDC',
  decimals: 6,
  supplied: '0',
  variableDebt: '0',
  suppliedValueUsd: '0',
  variableDebtValueUsd: '0',
  priceSource: 'chainlink:USDC/USD',
  priceObservedAt: '2026-10-24T02:59:00.000Z',
  observedAt: '2026-10-21T02:13:20.000Z',
  usageAsCollateralEnabled: true,
  reserveNote: null,
  ...over,
});

describe('usdToCents', () => {
  it('is exact to cents and truncates toward zero past the second digit', () => {
    expect(usdToCents('5.25')).toBe(525n);
    expect(usdToCents('2080')).toBe(208000n);
    expect(usdToCents('1.239')).toBe(123n); // truncated, never rounded up
    expect(usdToCents('1.231')).toBe(123n);
    expect(usdToCents('0.009')).toBe(0n);
  });
  it('null or unparseable is unknown, never zero', () => {
    expect(usdToCents(null)).toBeNull();
    expect(usdToCents('abc')).toBeNull();
    expect(usdToCents('1.2.3')).toBeNull();
    expect(usdToCents('-5')).toBeNull(); // API values are nonnegative by construction
  });
});

describe('aaveToPositions', () => {
  it('maps supplied and debt sides with the debt direction in kind, never a negative value', () => {
    const rows = aaveToPositions(
      [pos({ supplied: '5.25', variableDebt: '2.16', suppliedValueUsd: '5.25', variableDebtValueUsd: '2.16' })],
      WALLET,
    );
    expect(rows).toHaveLength(2);
    const supplied = rows.find((r) => r.kind === 'Supplied')!;
    const debt = rows.find((r) => r.kind === 'Debt')!;
    expect(supplied.valueCents).toBe(525n);
    expect(debt.valueCents).toBe(216n);
    expect(debt.valueCents).toBeGreaterThanOrEqual(0n);
    // summarize() counts by kind and must accept the rows without throwing.
    const s = summarize(rows);
    expect(s.assets).toBe(525n);
    expect(s.debt).toBe(216n);
    expect(s.net).toBe(309n);
  });
  it('both sides of the same reserve survive exposure deduplication (no dropped debt)', () => {
    const rows = aaveToPositions(
      [pos({ supplied: '5.25', variableDebt: '2.16', suppliedValueUsd: '5.25', variableDebtValueUsd: '2.16' })],
      WALLET,
    );
    expect(uniqueExposures(rows)).toHaveLength(2);
  });
  it('never creates receipt rows and never counts an aToken as a second asset', () => {
    const rows = aaveToPositions([pos({ supplied: '5.25', suppliedValueUsd: '5.25' })], WALLET);
    expect(rows.some((r) => r.kind === 'Receipt')).toBe(false);
    expect(rows.every((r) => !r.assetId.includes('aave'))).toBe(true);
    const alloc = assetAllocation(rows);
    expect(alloc).toHaveLength(1);
    expect(alloc[0]!.symbol).toBe('USDC');
  });
  it('an unpriced side counts as unpriced, not as zero', () => {
    const rows = aaveToPositions(
      [pos({ supplied: '42', suppliedValueUsd: null, priceSource: null, priceObservedAt: null })],
      WALLET,
    );
    expect(rows[0]!.valueCents).toBeNull();
    const s = summarize(rows);
    expect(s.unpriced).toBe(1);
    expect(s.incomplete).toBe(true);
    expect(s.assets).toBe(0n); // nothing priced, and nothing invented
  });
  it('a zero side produces no row at all (a true zero is not a position)', () => {
    expect(aaveToPositions([pos({})], WALLET)).toHaveLength(0);
    expect(aaveToPositions([], WALLET)).toHaveLength(0);
  });
});
