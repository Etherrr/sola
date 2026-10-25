import { describe, expect, it } from 'vitest';
import { assetsView, changesSincePrior, defiView, riskView } from '../server/portfolio/read-model';
import type { Position } from '../server/portfolio/domain';

const now = new Date();
const NOW = now.toISOString();

const asset = (id: string, symbol: string, decimals = 6) => ({ assetId: id, symbol, name: symbol, decimals });
const pos = (o: Partial<Position>): Position => ({
  asset: asset('eth:0xa', 'ETH', 18),
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

describe('assetsView', () => {
  it('shares are shares of the PRICED subtotal, not of everything', () => {
    const rows = assetsView([
      pos({}),
      pos({ asset: asset('eth:0xb', 'MYSTERY', 8), amount: '50', price: null, valueUsd: null }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].shareOfPricedPct).toBe('100'); // 3000/3000 of priced
    expect(rows[1].shareOfPricedPct).toBeNull(); // unpriced never invents a share
  });

  it('stale prices carry no share and are flagged', () => {
    const stale = new Date(now.getTime() - 60 * 60_000).toISOString();
    const rows = assetsView([pos({ price: { usd: '3000', source: 'test', observedAt: stale } })]);
    expect(rows[0].priceStale).toBe(true);
    expect(rows[0].shareOfPricedPct).toBeNull();
  });

  it('drops zero balances', () => {
    expect(assetsView([pos({ amount: '0',  valueUsd: '0' })])).toHaveLength(0);
  });

  it('kind and network travel through for filters (All/Spot/Supplied/Debt)', () => {
    const rows = assetsView([pos({}), pos({ kind: 'protocol_supplied', protocol: 'aave-v3', amount: '0.5', valueUsd: '1500' })]);
    expect(rows.map((r) => r.kind).sort()).toEqual(['protocol_supplied', 'wallet_balance']);
    expect(rows[1].shareOfPricedPct).toBe('33.33'); // 1500/4500
  });
});

describe('defiView', () => {
  it('groups supply+debt per protocol/network/address/asset with signed net', () => {
    const rows = defiView([
      pos({ kind: 'protocol_supplied', protocol: 'aave-v3', amount: '2', valueUsd: '6000' }),
      pos({ kind: 'protocol_debt', protocol: 'aave-v3', asset: asset('eth:0xc', 'USDC'), amount: '1000',  valueUsd: '1000' }),
    ]);
    expect(rows).toHaveLength(2);
    const eth = rows.find((r) => r.symbol === 'ETH')!;
    expect(eth.supplied).toBe('2');
    expect(eth.net).toBe('2');
    const usdc = rows.find((r) => r.symbol === 'USDC')!;
    expect(usdc.debt).toBe('1000');
    expect(usdc.net).toBe('-1000');
  });

  it('wallet balances never appear in the DeFi view', () => {
    expect(defiView([pos({})])).toHaveLength(0);
  });
});

describe('changesSincePrior', () => {
  it('null prior => honest first-observation state', () => {
    expect(changesSincePrior([pos({})], null)).toBeNull();
    expect(changesSincePrior([pos({})], [])).toBeNull();
  });

  it('reports signed deltas and skips unchanged assets', () => {
    const rows = changesSincePrior(
      [pos({ amount: '1.5' }), pos({ asset: asset('eth:0xb', 'UNI', 18), amount: '10' })],
      [
        { assetId: 'eth:0xa', amount: '2', observedAt: '2026-10-25T11:00:00Z' },
        { assetId: 'eth:0xb', amount: '10', observedAt: '2026-10-25T11:00:00Z' },
      ],
    )!;
    expect(rows).toHaveLength(1);
    expect(rows[0].assetId).toBe('eth:0xa');
    expect(rows[0].delta).toBe('-0.5');
  });

  it('a newly appeared asset is a change from 0', () => {
    const rows = changesSincePrior([pos({})], [{ assetId: 'eth:0xb', amount: '5', observedAt: NOW }])!;
    expect(rows[0].previousAmount).toBe('0');
    expect(rows[0].delta).toBe('1');
  });
});

describe('riskView', () => {
  it('concentrations over fresh-priced only; stablecoin share; debt ratio', () => {
    const v = riskView([
      pos({}),
      pos({ asset: asset('eth:0xc', 'USDC'), amount: '1000', valueUsd: '1000', price: { usd: '1', source: 'test', observedAt: NOW } }),
      pos({ kind: 'protocol_debt', protocol: 'aave-v3', asset: asset('eth:0xc', 'USDC'), amount: '500', valueUsd: '500', price: { usd: '1', source: 'test', observedAt: NOW } }),
    ]);
    expect(v.byAsset.find((r) => r.label === 'ETH')!.sharePct).toBe('75'); // 3000/4000
    expect(v.stablecoinSharePct).toBe('25'); // USDC spot only; debt excluded from base
    expect(v.debtToKnownAssets).toBe('0.125'); // 500/4000
    expect(v.partial).toBe(false);
  });

  it('any unpriced position marks the whole view partial', () => {
    const v = riskView([pos({}), pos({ asset: asset('eth:0xb', 'MYSTERY', 8), amount: '5', price: null, valueUsd: null })]);
    expect(v.partial).toBe(true);
  });

  it('no priced assets => null ratios, not div-by-zero', () => {
    const v = riskView([pos({ price: null, valueUsd: null })]);
    expect(v.debtToKnownAssets).toBeNull();
    expect(v.stablecoinSharePct).toBeNull();
    expect(v.byChain).toEqual([]);
  });

  it('stale prices fall out of the concentration base', () => {
    const stale = new Date(now.getTime() - 2 * 60 * 60_000).toISOString();
    const v = riskView([
      pos({}),
      pos({ asset: asset('eth:0xb', 'OLD', 8), amount: '10', valueUsd: '10', price: { usd: '1', source: 'test', observedAt: stale } }),
    ]);
    expect(v.byAsset).toHaveLength(1);
    expect(v.byAsset[0].label).toBe('ETH');
    expect(v.partial).toBe(true);
  });
});
