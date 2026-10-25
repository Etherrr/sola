import { describe, expect, it, vi } from 'vitest';
import { createOverviewCache, type OverviewDeps } from '../server/markets/overview';
import { INSTRUMENTS } from '../server/markets/instruments';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const pairFor = (mint: string, priceUsd: string) => ({
  chainId: 'solana',
  dexId: 'orca',
  pairAddress: 'A'.repeat(44),
  baseToken: { address: mint, symbol: 'X' },
  quoteToken: { address: USDC, symbol: 'USDC' },
  priceUsd,
  liquidity: { usd: 500_000 },
});
const bodyFor = (mint: string, price = '100.01') => JSON.stringify([pairFor(mint, price)]);

let now = 1_000_000;
const deps = (fetchImpl: (url: string) => Promise<Response>): OverviewDeps => ({
  fetchImpl: fetchImpl as never,
  now: () => now,
  ttlMs: 60_000,
  maxStaleMs: 600_000,
  minRefreshIntervalMs: 15_000,
  deadlineMs: 8_000,
});
const okFetch = (price = '100.01') => async (url: string) =>
  new Response(bodyFor(url.split('/').pop()!, price), { status: 200 });

describe('overview cache', () => {
  it('fetches each allowlist instrument once and prices them from the primary venue', async () => {
    const seen: string[] = [];
    const cache = createOverviewCache(
      deps(async (url) => {
        seen.push(url);
        return okFetch()(url);
      }),
    );
    const out = await cache.read(false);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(seen).toHaveLength(INSTRUMENTS.length);
    for (const i of INSTRUMENTS) expect(seen.join('|')).toContain(i.mint);
    expect(out.result.observations).toHaveLength(INSTRUMENTS.length);
    const sol = out.result.observations.find((o) => o.instrument === 'SOL')!;
    expect(sol.value).toBe('100.01');
    expect(sol.primaryVenue).toBe('orca');
    expect(sol.sourceUpdatedAt).toBeNull();
    expect(sol.warnings).toContain('single-venue');
    expect(out.result.stale).toBe(false);
  });

  it('serves the fresh cache with no new upstream call inside the TTL', async () => {
    const f = vi.fn(okFetch());
    const cache = createOverviewCache(deps(f));
    await cache.read(false);
    now += 30_000;
    await cache.read(false);
    expect(f).toHaveBeenCalledTimes(INSTRUMENTS.length);
  });

  it('coalesces concurrent reads into one batch (single-flight)', async () => {
    const f = vi.fn(okFetch());
    const cache = createOverviewCache(deps(f));
    const [a, b, c] = await Promise.all([cache.read(false), cache.read(true), cache.read(false)]);
    expect(f).toHaveBeenCalledTimes(INSTRUMENTS.length);
    for (const o of [a, b, c]) expect(o.kind).toBe('ok');
  });

  it('spaces forced refreshes and never hammers the vendor', async () => {
    const f = vi.fn(okFetch());
    const cache = createOverviewCache(deps(f));
    await cache.read(false);
    now += 10_000; // inside the forced-refresh spacing AND inside the TTL
    const out = await cache.read(true);
    expect(f).toHaveBeenCalledTimes(INSTRUMENTS.length); // no new batch
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.result.stale).toBe(false); // still fresh
    now += 15_001; // spacing elapsed but still inside the TTL: force now re-fetches
    await cache.read(true);
    expect(f).toHaveBeenCalledTimes(2 * INSTRUMENTS.length);
    now += 60_001; // past the TTL from the second batch: a plain read re-fetches on view
    await cache.read(false);
    expect(f).toHaveBeenCalledTimes(3 * INSTRUMENTS.length);
  });

  it('serves last good values marked stale when the source fails, then goes unavailable', async () => {
    let failing = false;
    const cache = createOverviewCache(
      deps(async (url) =>
        failing ? new Response('x', { status: 500 }) : okFetch()(url),
      ),
    );
    const good = await cache.read(false);
    expect(good.kind).toBe('ok');
    failing = true;
    now += 61_000;
    const stale = await cache.read(false);
    expect(stale.kind).toBe('ok');
    if (stale.kind === 'ok') {
      expect(stale.result.stale).toBe(true);
      expect(stale.result.observations[0].value).toBe('100.01'); // last good, not zero
    }
    now += 600_001; // beyond max staleness
    const gone = await cache.read(false);
    expect(gone.kind).toBe('unavailable');
  });

  it('marks instruments with no qualified venue as unpriced, never zero', async () => {
    const solMint = INSTRUMENTS[0].mint;
    const cache = createOverviewCache(
      deps(async (url) =>
        url.includes(solMint)
          ? new Response(JSON.stringify([]), { status: 200 })
          : okFetch()(url),
      ),
    );
    const out = await cache.read(false);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.result.observations.map((o) => o.instrument)).not.toContain('SOL');
    expect(out.result.unpriced).toEqual([{ instrument: 'SOL', reason: 'no-qualified-venue' }]);
    expect(out.result.observations.every((o) => o.value !== '0')).toBe(true);
  });

  it('is unavailable when every instrument fails', async () => {
    const cache = createOverviewCache(deps(async () => new Response('x', { status: 500 })));
    expect((await cache.read(false)).kind).toBe('unavailable');
  });

  it('keeps venue spread as an exact decimal string', async () => {
    const cache = createOverviewCache(
      deps(async (url) =>
        new Response(
          JSON.stringify([
            pairFor(url.split('/').pop()!, '371.19'),
            { ...pairFor(url.split('/').pop()!, '371.94'), dexId: 'raydium' },
          ]),
          { status: 200 },
        ),
      ),
    );
    const out = await cache.read(false);
    if (out.kind !== 'ok') throw new Error('expected ok');
    const tsla = out.result.observations.find((o) => o.instrument === 'TSLAx')!;
    expect(tsla.dispersionPct).toBe('0.20');
    expect(tsla.warnings).not.toContain('wide-dispersion');
  });
});
