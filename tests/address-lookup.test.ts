import { describe, it, expect } from 'vitest';
import { detectNetwork } from '../features/portfolio-v2/address-lookup';

describe('detectNetwork - chain-aware address shape detection', () => {
  it('detects EVM hex case-insensitively', () => {
    expect(detectNetwork('0xAbC1230000000000000000000000000000000000')).toBe('ethereum');
    expect(detectNetwork('0xabc1230000000000000000000000000000000000')).toBe('ethereum');
  });
  it('detects Solana base58 (32-44 chars, no 0OIl)', () => {
    expect(detectNetwork('So11111111111111111111111111111111111111112')).toBe('solana');
  });
  it('rejects everything else rather than guessing a network', () => {
    expect(detectNetwork('0x123')).toBeNull();
    expect(detectNetwork('0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl')).toBeNull();
    expect(detectNetwork('')).toBeNull();
    expect(detectNetwork('hello world')).toBeNull();
  });
});
