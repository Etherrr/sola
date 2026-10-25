import { describe, it, expect } from 'vitest';
import { assetLabel } from '../features/portfolio-v2/asset-label';

describe('assetLabel - human names from the assetId exactly as providers store it', () => {
  it('maps the two observed native ids to chain symbols', () => {
    expect(assetLabel('eip155:1/native')).toBe('ETH');
    expect(assetLabel('solana:mainnet/native')).toBe('SOL');
    expect(assetLabel('solana/native')).toBe('SOL');
  });
  it('shortens a token contract with checksum case PRESERVED (never uppercased)', () => {
    expect(assetLabel('eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBe('0xA0b8\u2026eB48');
  });
  it('never guesses: an unmapped native chain is NATIVE, not an invented symbol', () => {
    expect(assetLabel('eip155:56/native')).toBe('NATIVE');
  });
  it('non-contract identifiers stay as stored; unknown shapes fall back to their own last segment', () => {
    expect(assetLabel('eip155:1/defi:aave-v3-supply')).toBe('aave-v3-supply');
    expect(assetLabel('nonetwork')).toBe('nonetwork');
  });
});
