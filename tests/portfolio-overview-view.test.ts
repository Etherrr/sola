import { describe, expect, it } from 'vitest';
import { overviewAllocation, overviewTotals } from '../server/portfolio/read-model';
import type { Position } from '../server/portfolio/domain';

const now = new Date();
const NOW = now.toISOString();
const STALE = new Date(now.getTime() - 60 * 60_000).toISOString();

const asset = (id: string, symbol: string, decimals = 6) => ({ assetId: id, symbol, name: symbol, decimals });
const pos = (o: Partial<Position>): Position => ({
  asset: asset('eip155:1/native', 'ETH', 18),
  address: '0xabc',
  network: 'ethereum',
  protocol: null,
  amount: '1',
  price: { usd: '3000', source: 'test', observedAt: NOW },
  valueUsd: '3000',
  observedAt: NOW,
  source: 'test',
  kind: 'wallet_balance',
  ...o,
});
const debt = (o: Partial<Position>): Position =>
  pos({ kind: 'protocol_debt', protocol: 'aave-v3', asset: asset('eip155:1/erc20:USDC', 'USDC'), amount: '1000', price: { usd: '1', source: 'test', observedAt: NOW }, valueUsd: '1000', ...o });

describe('overviewTotals - A2/PIN1 null vs zero matrix', () => {
  it('zero asset rows + priced debt rows -> gross 0 (observed-empty), net negative computable (PIN1a)', () => {
    const t = overviewTotals([debt({})]);
    expect(t.assetRowCount).toBe(0);
    expect(t.grossPricedUsd).toBe('0');
    expect(t.netUsd).toBe('-1000');
    expect(t.netPartial).toBe(false);
  });

  it('asset rows ALL unpriced -> gross null, net suppressed (A2c/PIN1c)', () => {
    const t = overviewTotals([pos({ price: null, valueUsd: null })]);
    expect(t.grossPricedUsd).toBeNull();
    expect(t.unpricedAssetCount).toBe(1);
    expect(t.netUsd).toBeNull();
  });

  it('asset rows ALL stale-priced -> gross null (stale is not a usable price), partial flagged', () => {
    const t = overviewTotals([pos({ price: { usd: '3000', source: 'test', observedAt: STALE } })]);
    expect(t.grossPricedUsd).toBeNull();
    expect(t.staleAssetCount).toBe(1);
    expect(t.grossPartial).toBe(true);
  });

  it('mixed priced + unpriced -> priced subtotal + PARTIAL, net labeled partial (A2d/PIN2)', () => {
    const t = overviewTotals([pos({}), pos({ asset: asset('eip155:1/erc20:X', 'X'), price: null, valueUsd: null })]);
    expect(t.grossPricedUsd).toBe('3000');
    expect(t.grossPartial).toBe(true);
    expect(t.netUsd).toBe('3000');
    expect(t.netPartial).toBe(true);
  });

  it('debt never enters gross (A3)', () => {
    const t = overviewTotals([pos({}), debt({})]);
    expect(t.grossPricedUsd).toBe('3000');
    expect(t.recordedDebtUsd).toBe('1000');
    expect(t.netUsd).toBe('2000');
  });
});

describe('overviewTotals - A3 debt/net states', () => {
  it('no debt rows -> debtState none, net = gross labeled', () => {
    const t = overviewTotals([pos({})]);
    expect(t.debtState).toBe('none');
    expect(t.recordedDebtUsd).toBeNull();
    expect(t.netUsd).toBe('3000');
  });

  it('ANY unpriced debt row -> partially_unknown and net SUPPRESSED entirely (A3)', () => {
    const t = overviewTotals([pos({}), debt({ price: null, valueUsd: null })]);
    expect(t.debtState).toBe('partially_unknown');
    expect(t.netUsd).toBeNull();
  });

  it('stale-priced debt also suppresses net', () => {
    const t = overviewTotals([pos({}), debt({ price: { usd: '1', source: 'test', observedAt: STALE } })]);
    expect(t.debtState).toBe('partially_unknown');
    expect(t.netUsd).toBeNull();
  });

  it('debt-only portfolio: net negative honest when both sides priced (A3)', () => {
    const t = overviewTotals([debt({}), debt({ amount: '500', valueUsd: '500' })]);
    expect(t.grossPricedUsd).toBe('0');
    expect(t.recordedDebtUsd).toBe('1500');
    expect(t.netUsd).toBe('-1500');
  });

  it('zero-amount rows are not positions (known-empty uses real rows)', () => {
    const t = overviewTotals([pos({ amount: '0', valueUsd: '0' })]);
    expect(t.assetRowCount).toBe(0);
    expect(t.grossPricedUsd).toBe('0');
  });
});

describe('overviewAllocation - A5 denominators', () => {
  it('byNetwork and byCategory share the SAME gross priced denominator; debt excluded from both', () => {
    const a = overviewAllocation([
      pos({}),
      pos({ kind: 'protocol_supplied', protocol: 'aave-v3', amount: '0.5', valueUsd: '1500' }),
      debt({}),
    ]);
    const byCat = Object.fromEntries(a.byCategory.map((r) => [r.label, r]));
    expect(byCat.spot.valueUsd).toBe('3000');
    expect(byCat.supplied.valueUsd).toBe('1500');
    expect(byCat.spot.sharePct).toBe('66.67');
    expect(byCat.supplied.sharePct).toBe('33.33');
    expect(byCat.debt).toBeUndefined();
    expect(a.byNetwork).toHaveLength(1);
    expect(a.byNetwork[0].label).toBe('ethereum');
    expect(a.byNetwork[0].sharePct).toBe('100');
  });

  it('category set is spot/supplied ONLY - no invented rows (A5)', () => {
    const a = overviewAllocation([pos({})]);
    expect(a.byCategory.map((r) => r.label)).toEqual(['spot']);
  });

  it('unpriced/stale positions carry no allocation share (Assets-page rule)', () => {
    const a = overviewAllocation([pos({}), pos({ asset: asset('eip155:1/erc20:Y', 'Y'), price: null, valueUsd: null })]);
    expect(a.byNetwork[0].sharePct).toBe('100');
  });
});
