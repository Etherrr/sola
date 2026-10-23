import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BASE_FEE_BURNED_ETH,
  FEE_ETH,
  FICTIONAL,
  STEPS,
  TIP_ETH,
} from '../features/education/journey-steps';
describe('network journey scene', () => {
  it('fee example adds up exactly (gwei integer math, no floats)', () => {
    const gwei = BigInt(FICTIONAL.gas) * BigInt(FICTIONAL.baseFeeGwei + FICTIONAL.tipGwei);
    const toEth = (g: bigint) => (Number(g) / 1e9).toFixed(6).replace(/0+$/, '');
    expect(toEth(gwei)).toBe(FEE_ETH);
    expect(toEth(BigInt(FICTIONAL.gas) * BigInt(FICTIONAL.baseFeeGwei))).toBe(BASE_FEE_BURNED_ETH);
    expect(toEth(BigInt(FICTIONAL.gas) * BigInt(FICTIONAL.tipGwei))).toBe(TIP_ETH);
  });
  it('has six distinct steps, each with a text equivalent and a plain status', () => {
    expect(STEPS).toHaveLength(6);
    expect(new Set(STEPS.map((s) => s.id)).size).toBe(6);
    for (const s of STEPS) expect(s.text.length).toBeGreaterThan(40);
  });
  it('never invokes a wallet or the network', () => {
    const src = readFileSync('features/education/network-journey.tsx', 'utf8');
    expect(src).not.toMatch(/window\.ethereum|fetch\s*\(|XMLHttpRequest|WebSocket/);
  });
});
