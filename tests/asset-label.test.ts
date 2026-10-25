import { describe, it, expect } from 'vitest';
import { assetLabel } from '../features/portfolio-v2/asset-label';

describe('assetLabel - human names derived from the normalized assetId', () => {
  it('maps native balances to chain symbols', () => {
    expect(assetLabel('eth/native')).toBe('ETH');
    expect(assetLabel('sol/native')).toBe('SOL');
  });
  it('maps erc20 ids to their uppercase symbol', () => {
    expect(assetLabel('eth/erc20:usdc')).toBe('USDC');
    expect(assetLabel('eth/erc20:wbtc')).toBe('WBTC');
  });
  it('never invents: unknown shapes fall back to their own last segment', () => {
    expect(assetLabel('eth/defi:aave-v3-supply')).toBe('aave-v3-supply');
    expect(assetLabel('nonetwork')).toBe('nonetwork');
  });
});
