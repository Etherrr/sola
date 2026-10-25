import { describe, expect, it, vi } from 'vitest';
import { qualifyPairs, pickPrimary, fetchTokenPairs } from '../server/markets/dexscreener';
import { INSTRUMENTS } from '../server/markets/instruments';

const TSLAX = INSTRUMENTS.find((i) => i.id === 'tslax')!;
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';
const PAIR = (n: number) => 'P'.repeat(31) + String(n).padStart(13, 'ABC1DEF2GH3JK');

const pair = (over: Record<string, unknown> = {}) => ({
  chainId: 'solana',
  dexId: 'raydium',
  pairAddress: PAIR(1),
  baseToken: { address: TSLAX.mint, symbol: 'TSLAx' },
  quoteToken: { address: USDC, symbol: 'USDC' },
  priceUsd: '371.52',
  liquidity: { usd: 100_000 },
  ...over,
});

describe('qualifyPairs', () => {
  it('keeps only solana pairs with the allowlist mint as base and a USD-stable quote', () => {
    const out = qualifyPairs(
      [
        pair(),
        pair({ chainId: 'ethereum' }), // wrong chain
        pair({ baseToken: { address: USDC }, quoteToken: { address: TSLAX.mint } }), // inverted
        pair({ quoteToken: { address: WSOL, symbol: 'SOL' } }), // SOL quote
        pair({ priceUsd: 'NaN' }),
        pair({ priceUsd: '0' }),
        pair({ liquidity: { usd: 5_000 } }), // below threshold
        pair({ liquidity: undefined }),
        pair({ dexId: 'Bad DEX!' }),
        pair({ pairAddress: 'short' }),
        'junk',
        null,
      ],
      TSLAX,
    );
    expect(out).toHaveLength(1);
    expect(out[0].priceUsd).toBe('371.52');
    expect(out[0].quoteSymbol).toBe('USDC');
  });
  it('caps the number of pairs read', () => {
    const many = Array.from({ length: 80 }, (_, i) => pair({ pairAddress: PAIR(i) }));
    expect(qualifyPairs(many, TSLAX).length).toBeLessThanOrEqual(50);
  });
  it('returns [] for a non-array payload', () => {
    expect(qualifyPairs({ pairs: [] }, TSLAX)).toEqual([]);
  });
  it('pickPrimary chooses the deepest pool', () => {
    const thin = pair({ liquidity: { usd: 50_000 }, dexId: 'orca' });
    const deep = pair({ liquidity: { usd: 2_000_000 }, dexId: 'raydium' });
    expect(pickPrimary(qualifyPairs([thin, deep], TSLAX))!.dexId).toBe('raydium');
    expect(pickPrimary([])).toBeNull();
  });
});

describe('fetchTokenPairs', () => {
  const okResponse = (body: string) =>
    new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  it('fetches the fixed endpoint with the allowlist mint only', async () => {
    const fetchImpl = vi.fn(async () => okResponse(JSON.stringify([pair()])));
    const ctl = new AbortController();
    const r = await fetchTokenPairs(fetchImpl as never, TSLAX, ctl.signal);
    expect(r.ok).toBe(true);
    const url = (fetchImpl.mock.calls[0] as unknown[])[0] as string;
    expect(url).toBe(`https://api.dexscreener.com/token-pairs/v1/solana/${TSLAX.mint}`);
    expect(url).not.toContain('0x'); // no wallet address ever leaves this path
  });
  it('maps http errors, bad json and oversize bodies to finite reasons', async () => {
    const ctl = new AbortController();
    expect(
      await fetchTokenPairs((async () => new Response('x', { status: 429 })) as never, TSLAX, ctl.signal),
    ).toEqual({ ok: false, reason: 'http' });
    expect(
      await fetchTokenPairs((async () => okResponse('not json')) as never, TSLAX, ctl.signal),
    ).toEqual({ ok: false, reason: 'invalid_body' });
    const big = 'a'.repeat(400 * 1024);
    expect(
      await fetchTokenPairs((async () => okResponse(big)) as never, TSLAX, ctl.signal),
    ).toEqual({ ok: false, reason: 'too_large' });
    expect(
      await fetchTokenPairs(
        (async () => {
          throw new Error('boom');
        }) as never,
        TSLAX,
        ctl.signal,
      ),
    ).toEqual({ ok: false, reason: 'fetch_error' });
  });
});
