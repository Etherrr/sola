import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INSTRUMENTS, QUOTE_MINTS } from '../server/markets/instruments';

describe('the instrument allowlist', () => {
  it('is fixed, small and unique', () => {
    expect(INSTRUMENTS.length).toBe(5);
    expect(new Set(INSTRUMENTS.map((i) => i.id)).size).toBe(5);
    expect(new Set(INSTRUMENTS.map((i) => i.mint)).size).toBe(5);
  });
  it('never labels a tokenized instrument as its underlying', () => {
    for (const i of INSTRUMENTS) {
      if (i.kind === 'tokenized-equity') {
        expect(i.underlying).toBeTruthy();
        expect(i.issuer).toBeTruthy();
        expect(i.symbol).not.toBe(i.underlying);
        expect(i.symbol.endsWith('x')).toBe(true);
      }
    }
  });
  it('keeps wrapped SOL explicit and never claims cross-chain assets', () => {
    const sol = INSTRUMENTS.find((i) => i.id === 'sol')!;
    expect(sol.mint).toBe('So11111111111111111111111111111111111111112');
    for (const i of INSTRUMENTS) expect(i.chain).toBe('solana');
    expect(INSTRUMENTS.map((i) => i.symbol)).not.toContain('BTC');
    expect(INSTRUMENTS.map((i) => i.symbol)).not.toContain('ETH');
  });
  it('documents an official registry source for every mint', () => {
    const src = readFileSync('server/markets/instruments.ts', 'utf8');
    expect(src).toContain('native_mint.rs');
    expect(src).toContain('Circle');
    expect(src).toContain('Tether');
    const docs = readFileSync('docs/MARKETS_OVERVIEW.md', 'utf8');
    expect(docs).toContain('api.xstocks.fi/api/v2/public/assets');
    for (const i of INSTRUMENTS) expect(docs).toContain(i.mint);
    for (const m of Object.keys(QUOTE_MINTS)) expect(docs).toContain(m);
  });
});
