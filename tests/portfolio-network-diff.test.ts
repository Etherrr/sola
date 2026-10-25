import { describe, it, expect } from 'vitest';
import { diffNetwork, subDec, isZero, keyOf } from '../features/portfolio-v2/network-diff';
import type { ObservedAmount } from '../features/portfolio-v2/overview-history';

const amt = (network: 'ethereum' | 'solana', address: string, assetId: string, amount: string): ObservedAmount =>
  ({ network, address, assetId, kind: 'wallet_balance', amount, observedAt: '2026-10-25T00:00:00Z' });

describe('diffNetwork - per-network isolation (reviewer MEDIUM regression)', () => {
  it('SOL first observation shows every row as first-seen even when an ETH prior exists', () => {
    // The bug: a merged global prior compared an ETH prior against a SOL
    // latest, producing false SOL additions. Per-network slices never mix.
    const solLatest = [amt('solana', 'SoLaddrABC', 'sol/sol', '3')];
    const ethPrior = [amt('ethereum', '0xabc', 'eth/eth', '2')];
    const sol = diffNetwork({ latest: solLatest, prior: null });
    expect(sol.rows).toHaveLength(1);
    expect(sol.rows[0].prev).toBeUndefined();
    expect(sol.removed).toHaveLength(0);
    // And the ETH prior diffed against its own (missing) latest surfaces as removed, not vanished.
    const eth = diffNetwork({ latest: [], prior: ethPrior });
    expect(eth.rows).toHaveLength(0);
    expect(eth.removed).toHaveLength(1);
    expect(eth.removed[0].amount).toBe('2');
  });

  it('removals are explicit: a prior row absent from the latest is reported, never silently dropped', () => {
    const prior = [amt('ethereum', '0xaaa', 'eth/usdc', '10'), amt('ethereum', '0xaaa', 'eth/eth', '1')];
    const latest = [amt('ethereum', '0xaaa', 'eth/eth', '1')];
    const d = diffNetwork({ latest, prior });
    expect(d.rows).toHaveLength(0); // unchanged row filtered
    expect(d.removed.map((o) => o.assetId)).toEqual(['eth/usdc']);
  });

  it('computes deltas only within the same network/address/asset key', () => {
    const prior = [amt('ethereum', '0xAAA', 'eth/eth', '1.5')];
    const latest = [amt('ethereum', '0xaaa', 'eth/eth', '2')]; // EVM case-insensitive
    const d = diffNetwork({ latest, prior });
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].prev).toBe('1.5');
    expect(d.rows[0].delta).toBe('0.5');
    expect(d.removed).toHaveLength(0);
  });

  it('Solana addresses compare case-sensitively (base58)', () => {
    expect(keyOf(amt('solana', 'AbC', 's', '1'))).not.toBe(keyOf(amt('solana', 'abc', 's', '1')));
    expect(keyOf(amt('ethereum', '0xAbC', 'e', '1'))).toBe(keyOf(amt('ethereum', '0xabc', 'e', '1')));
  });

  it('decimal arithmetic: subtraction including a negative result', () => {
    expect(subDec('2.5', '1')).toBe('1.5');
    expect(subDec('1', '2.5')).toBe('-1.5');
    expect(subDec('1.00', '1')).toBe('0');
    expect(isZero(subDec('0.5', '0.50'))).toBe(true);
  });
});
