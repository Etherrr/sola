import { describe, it, expect } from 'vitest';
import { rowsForAddress, type ObservedAmount } from '../features/portfolio-v2/overview-history';

const amt = (network: 'ethereum' | 'solana', address: string, assetId: string): ObservedAmount =>
  ({ network, address, assetId, kind: 'wallet_balance', amount: '1', observedAt: '2026-10-25T00:00:00Z' });

describe('rowsForAddress - one address from the normalized payload', () => {
  it('matches EVM addresses case-insensitively and only its own rows', () => {
    const rows = [
      amt('ethereum', '0xAbC123', 'eth/eth'),
      amt('ethereum', '0xOther', 'eth/eth'),
      amt('solana', '0xAbC123', 'sol/sol'), // same string, different network
    ];
    const out = rowsForAddress(rows, 'ethereum', '0xabc123');
    expect(out).toHaveLength(1);
    expect(out[0].assetId).toBe('eth/eth');
  });

  it('matches Solana addresses case-SENSITIVELY (base58)', () => {
    const rows = [amt('solana', 'SoLAddrABC', 'sol/sol')];
    expect(rowsForAddress(rows, 'solana', 'SoLAddrABC')).toHaveLength(1);
    expect(rowsForAddress(rows, 'solana', 'soladdrabc')).toHaveLength(0);
  });

  it('returns [] when the address has no recorded rows (never invents)', () => {
    expect(rowsForAddress([amt('ethereum', '0xaaa', 'eth/eth')], 'ethereum', '0xbbb')).toEqual([]);
  });
});
