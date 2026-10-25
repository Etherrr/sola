import { describe, expect, it } from 'vitest';
import { aggregateAddresses, usdToCents, type AggregateInput } from '../features/portfolio/aggregate';
import { summarize, networkAllocation } from '../features/portfolio/model';
import type { ApiWallet } from '../features/portfolio/api-client';

const ETH1 = '0x' + 'a'.repeat(40);
const ETH2 = '0x' + 'b'.repeat(40);
const SOL1 = 'So1DemoAddr9' + 'z'.repeat(31);

const wallet = (address: string, assets: ApiWallet['assets'], partial = false): ApiWallet => ({
  address,
  assets,
  partial,
  warnings: partial ? ['One source was unreachable.'] : [],
});
const asset = (assetId: string, symbol: string, amount: string, value: string | null) => ({
  assetId,
  symbol,
  decimals: 18,
  amount,
  price: value,
  value,
});
const ok = (wallets: ApiWallet[], observedAt: string, partial = false): AggregateInput['outcome'] => ({
  kind: 'ok',
  data: {
    mode: 'mock',
    simulated: true,
    provider: 'fixture',
    generatedAt: observedAt,
    observedAt,
    wallets,
    totals: { recognizedPricedSubtotalUsd: null, unpricedAssetCount: 0, note: 'n' },
    partial,
    warnings: partial ? ['Partial data.'] : [],
  },
});
const input = (
  network: 'ethereum' | 'solana',
  address: string,
  outcome: AggregateInput['outcome'],
  label?: string,
): AggregateInput => ({ network, address, label, outcome });

describe('usdToCents', () => {
  it('converts exactly and rounds half-up past the cent', () => {
    expect(usdToCents('4500')).toBe(450000n);
    expect(usdToCents('0.1')).toBe(10n);
    expect(usdToCents('1.005')).toBe(101n); // 100.5 cents rounds up
    expect(usdToCents('0.00000001')).toBe(0n); // truncates below a micro-dollar, rounds to 0
    expect(usdToCents('2500.00')).toBe(250000n);
  });
  it('rejects non-decimals and negatives', () => {
    expect(usdToCents('abc')).toBeNull();
    expect(usdToCents('-5')).toBeNull();
    expect(usdToCents('1.2.3')).toBeNull();
  });
});

describe('aggregateAddresses', () => {
  it('combines wallets across networks, preserving network identity', () => {
    const r = aggregateAddresses([
      input('ethereum', ETH1, ok([wallet(ETH1, [asset('e:eth', 'ETH', '1.5', '4500')])], '2026-10-24T10:00:00Z')),
      input('solana', SOL1, ok([wallet(SOL1, [asset('s:sol', 'SOL', '20', '3000')])], '2026-10-24T09:30:00Z')),
    ]);
    expect(r.positions).toHaveLength(2);
    expect(r.positions[0]).toMatchObject({ network: 'Ethereum', kind: 'Wallet', valueCents: 450000n, quantity: '1.5' });
    expect(r.positions[1]).toMatchObject({ network: 'Solana', valueCents: 300000n });
    const s = summarize(r.positions);
    expect(s.net).toBe(750000n);
    expect(s.incomplete).toBe(false);
    expect(r.incomplete).toBe(false);
    const alloc = networkAllocation(r.positions);
    expect(alloc.find((a) => a.network === 'Ethereum')?.percent).toBe(60);
    expect(r.observedRange).toEqual({ earliest: '2026-10-24T09:30:00Z', latest: '2026-10-24T10:00:00Z' });
  });

  it('never double-counts the same (network, address) submitted twice', () => {
    const r = aggregateAddresses([
      input('ethereum', ETH1, ok([wallet(ETH1, [asset('e:eth', 'ETH', '1', '100')])], '2026-10-24T10:00:00Z')),
      input('ethereum', ETH1, ok([wallet(ETH1, [asset('e:eth', 'ETH', '1', '100')])], '2026-10-24T10:01:00Z')),
    ]);
    expect(r.positions).toHaveLength(1);
    expect(summarize(r.positions).net).toBe(10000n);
    expect(r.perAddress[1].status).toBe('duplicate');
  });

  it('keeps the same asset in two different wallets as two real holdings', () => {
    const r = aggregateAddresses([
      input('ethereum', ETH1, ok([wallet(ETH1, [asset('e:eth', 'ETH', '1', '100')])], '2026-10-24T10:00:00Z')),
      input('ethereum', ETH2, ok([wallet(ETH2, [asset('e:eth', 'ETH', '2', '200')])], '2026-10-24T10:00:00Z')),
    ]);
    expect(r.positions).toHaveLength(2);
    expect(summarize(r.positions).net).toBe(30000n);
  });

  it('ignores a repeated assetId inside one wallet (double-count guard)', () => {
    const r = aggregateAddresses([
      input('ethereum', ETH1, ok([wallet(ETH1, [asset('e:eth', 'ETH', '1', '100'), asset('e:eth', 'ETH', '9', '900')])], '2026-10-24T10:00:00Z')),
    ]);
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0].quantity).toBe('1'); // first row wins
    expect(r.perAddress[0].warnings.join(' ')).toContain('Duplicate');
  });

  it('keeps unknown prices unknown and marks the aggregate incomplete', () => {
    const r = aggregateAddresses([
      input('ethereum', ETH1, ok([wallet(ETH1, [asset('e:eth', 'ETH', '1', '100'), asset('e:xyz', 'XYZ', '5', null)])], '2026-10-24T10:00:00Z')),
    ]);
    expect(r.positions[1].valueCents).toBeNull();
    const s = summarize(r.positions);
    expect(s.assets).toBe(10000n); // unpriced excluded from the total, never zero-filled
    expect(s.unpriced).toBe(1);
    expect(r.incomplete).toBe(true);
    expect(r.perAddress[0].unpricedAssets).toBe(1);
  });

  it('marks failed addresses, contributes nothing, and keeps them visible', () => {
    const r = aggregateAddresses([
      input('ethereum', ETH1, ok([wallet(ETH1, [asset('e:eth', 'ETH', '1', '100')])], '2026-10-24T10:00:00Z')),
      input('solana', SOL1, { kind: 'error', message: 'Rate limited. Try again in 30s.', retryable: true }),
    ]);
    expect(r.positions).toHaveLength(1);
    expect(r.perAddress[1]).toMatchObject({ status: 'failed', observedAt: null });
    expect(r.incomplete).toBe(true);
    expect(r.observedRange).toEqual({ earliest: '2026-10-24T10:00:00Z', latest: '2026-10-24T10:00:00Z' });
  });

  it('carries partial status and per-address observed times independently', () => {
    const r = aggregateAddresses([
      input('ethereum', ETH1, ok([wallet(ETH1, [asset('e:eth', 'ETH', '1', '100')], true)], '2026-10-24T08:00:00Z', true)),
      input('ethereum', ETH2, ok([wallet(ETH2, [asset('e:usdc', 'USDC', '50', '50')])], '2026-10-24T11:00:00Z')),
    ]);
    expect(r.perAddress[0]).toMatchObject({ status: 'partial', observedAt: '2026-10-24T08:00:00Z' });
    expect(r.perAddress[1]).toMatchObject({ status: 'ok', observedAt: '2026-10-24T11:00:00Z' });
    expect(r.incomplete).toBe(true);
    expect(r.observedRange).toEqual({ earliest: '2026-10-24T08:00:00Z', latest: '2026-10-24T11:00:00Z' });
  });

  it('passes quantity strings through verbatim across decimal precisions', () => {
    const r = aggregateAddresses([
      input('solana', SOL1, ok([wallet(SOL1, [
        { assetId: 's:sol', symbol: 'SOL', decimals: 9, amount: '0.000000001', price: '1', value: '0.000000001' },
        { assetId: 's:big', symbol: 'BIG', decimals: 0, amount: '123456789', price: '2', value: '246913578' },
      ])], '2026-10-24T10:00:00Z')),
    ]);
    expect(r.positions[0].quantity).toBe('0.000000001');
    expect(r.positions[1].quantity).toBe('123456789');
    expect(r.positions[1].valueCents).toBe(24691357800n);
  });
});
