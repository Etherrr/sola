import { describe, expect, it } from 'vitest';
import { fixture } from '../features/portfolio/fixture';
import {
  money,
  networkAllocation,
  assetAllocation,
  symbolColor,
  summarize,
  uniqueExposures,
  type Position,
} from '../features/portfolio/model';
describe('simulated financial accounting', () => {
  it('subtracts debt and flags unknown prices', () => {
    expect(summarize(fixture.positions)).toEqual({
      assets: 1200000n,
      debt: 100000n,
      net: 1100000n,
      unpriced: 1,
      incomplete: true,
    });
  });
  it('counts LP exposure once, excludes receipts regardless of order, and deduplicates holdings', () => {
    const duplicate = { ...fixture.positions[0], id: 'duplicate' };
    expect(summarize([...fixture.positions].reverse().concat(duplicate))).toEqual(
      summarize(fixture.positions),
    );
    expect(uniqueExposures(fixture.positions)).toHaveLength(6);
  });
  it('treats empty accounts as valid and known zero differently from missing prices', () => {
    expect(summarize([])).toEqual({
      assets: 0n,
      debt: 0n,
      net: 0n,
      unpriced: 0,
      incomplete: false,
    });
    expect(money(null)).toBe('Unknown');
    expect(money(0n)).toBe('$0.00');
  });
  it('preserves exact cents above Number.MAX_SAFE_INTEGER', () => {
    const large: Position = { ...fixture.positions[0], valueCents: 900719925474099301n };
    expect(summarize([large]).net).toBe(900719925474099301n);
    expect(money(large.valueCents)).toBe('$9,007,199,254,740,993.01');
  });
  it('allows negative net portfolios and rejects ambiguous negative position values', () => {
    expect(summarize([fixture.positions[3]]).net).toBe(-100000n);
    expect(money(-101n)).toBe('−$1.01');
    expect(() => summarize([{ ...fixture.positions[0], valueCents: -1n }])).toThrow();
  });
});

it('derives gross network allocation without debt, receipts, or missing prices', () => {
  expect(networkAllocation(fixture.positions)).toEqual([
    { network: 'Ethereum', value: 700000n, percent: 58.3, roundedZero: false },
    { network: 'Solana', value: 500000n, percent: 41.7, roundedZero: false },
  ]);
  expect(networkAllocation([])).toEqual([]);
});

it('asset allocation groups by symbol, excludes debt and unpriced, sorts by value, exact percents', () => {
  const rows = assetAllocation(fixture.positions);
  expect(rows.some((r) => r.symbol === 'DEMO')).toBe(false);
  const sum = rows.reduce((a, r) => a + r.value, 0n);
  expect(sum).toBe(12000_00n);
  for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.value >= rows[i]!.value).toBe(true);
  expect(assetAllocation([])).toEqual([]);
});
const P = (o: Partial<Position>): Position => ({
  id: 'i',
  exposureId: 'e',
  assetId: 'a',
  symbol: 'X',
  network: 'Ethereum',
  kind: 'Wallet',
  quantity: '1',
  valueCents: 100n,
  ...o,
});
it('allocation: exact percents, debt/unpriced/receipt excluded, same ticker stays separate by assetId', () => {
  const rows = assetAllocation([
    P({ id: '1', exposureId: '1', assetId: 'a1', symbol: 'USDC', valueCents: 100n }),
    P({ id: '2', exposureId: '2', assetId: 'a2', symbol: 'USDC', valueCents: 200n }),
    P({
      id: '3',
      exposureId: '3',
      assetId: 'a1',
      symbol: 'USDC',
      valueCents: 100n,
      kind: 'Supplied',
    }),
    P({ id: '4', exposureId: '4', assetId: 'd', symbol: 'D', kind: 'Debt', valueCents: 999n }),
    P({ id: '5', exposureId: '5', assetId: 'u', symbol: 'U', valueCents: null }),
    P({ id: '6', exposureId: '6', assetId: 'r', symbol: 'R', kind: 'Receipt', valueCents: 999n }),
    P({ id: '7', exposureId: '1', assetId: 'a1', symbol: 'USDC', valueCents: 100n }),
  ]);
  expect(rows.map((r) => [r.assetId, r.value, r.percent])).toEqual([
    ['a1', 200n, 50],
    ['a2', 200n, 50],
  ]);
});
it('symbol colour is stable', () => {
  expect(symbolColor('ETH')).toBe(symbolColor('ETH'));
  expect(symbolColor('ETH')).toMatch(/^#[0-9a-f]{6}$/);
});
it('the sample symbols get distinct colours', () => {
  const c = ['ETH', 'SOL', 'USDC', 'SOL / USDC', 'DEMO'].map(symbolColor);
  expect(new Set(c).size).toBe(c.length);
});
