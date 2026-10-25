import type { MarketOverviewResult, PriceObservation } from '../../features/markets/model';
import { INSTRUMENTS } from './instruments';
import { cmpDecimal, spreadPct } from './decimal';
import { DISPERSION_WARN_PCT, fetchTokenPairs, pickPrimary, type QualifiedPair } from './dexscreener';

/**
 * Overview orchestration + bounded cache. The ONLY way an upstream request happens is a call
 * to read(); there is no timer, cron or background refresh anywhere. Forced refreshes are
 * additionally spaced by minRefreshIntervalMs per isolate, so a caller cannot hammer the
 * vendor through ?refresh=1. On upstream failure the last good batch is served explicitly
 * marked stale (bounded by MAX_STALE_MS); after that the result is unavailable. A missing
 * price is NEVER reconstructed, estimated or rendered as zero.
 */
export const TTL_MS = 60_000;
export const MAX_STALE_MS = 10 * 60_000;
export const MIN_REFRESH_INTERVAL_MS = 15_000;
export const OVERALL_DEADLINE_MS = 8_000;

export type OverviewDeps = {
  fetchImpl: typeof fetch;
  now: () => number;
  ttlMs: number;
  maxStaleMs: number;
  minRefreshIntervalMs: number;
  deadlineMs: number;
};

export const defaultOverviewDeps = (): OverviewDeps => ({
  fetchImpl: fetch,
  now: Date.now,
  ttlMs: TTL_MS,
  maxStaleMs: MAX_STALE_MS,
  minRefreshIntervalMs: MIN_REFRESH_INTERVAL_MS,
  deadlineMs: OVERALL_DEADLINE_MS,
});

type Batch = {
  observations: PriceObservation[];
  unpriced: { instrument: string; reason: string }[];
  retrievedAtMs: number;
};

function buildObservation(
  inst: (typeof INSTRUMENTS)[number],
  pairs: QualifiedPair[],
): PriceObservation | null {
  const primary = pickPrimary(pairs);
  if (!primary) return null;
  const venueNames = [...new Set(pairs.map((p) => p.dexId))];
  const prices = pairs.map((p) => p.priceUsd);
  const lo = prices.reduce((a, b) => (cmpDecimal(a, b) <= 0 ? a : b));
  const hi = prices.reduce((a, b) => (cmpDecimal(a, b) >= 0 ? a : b));
  const dispersionPct = venueNames.length > 1 ? spreadPct(lo, hi) : null;
  const warnings: string[] = [];
  if (venueNames.length === 1) warnings.push('single-venue');
  if (dispersionPct !== null && cmpDecimal(dispersionPct, DISPERSION_WARN_PCT) > 0)
    warnings.push('wide-dispersion');
  if (pairs.length <= 1) warnings.push('few-pools');
  return {
    metric: 'overview',
    instrument: inst.symbol,
    name: inst.name,
    kind: inst.kind,
    issuer: inst.issuer,
    underlying: inst.underlying,
    chain: 'solana',
    mint: inst.mint,
    value: primary.priceUsd,
    unit: 'USD',
    primaryVenue: primary.dexId,
    primaryPairAddress: primary.pairAddress,
    venues: venueNames,
    venueCount: venueNames.length,
    // Display-only context, rounded to whole dollars; never used as a quote.
    liquidityUsdApprox: String(Math.round(primary.liquidityUsd)),
    dispersionPct,
    source: 'DexScreener',
    sourceUpdatedAt: null,
    coverage: 'selected-venues',
    warnings,
  };
}

async function runBatch(d: OverviewDeps, signal: AbortSignal): Promise<Batch | null> {
  const results = await Promise.all(
    INSTRUMENTS.map(async (inst) => {
      const r = await fetchTokenPairs(d.fetchImpl, inst, signal);
      if (!r.ok) return { inst, error: r.reason as string };
      const obs = buildObservation(inst, r.pairs);
      return obs ? { inst, obs } : { inst, error: 'no-qualified-venue' };
    }),
  );
  if (signal.aborted) return null;
  const observations: PriceObservation[] = [];
  const unpriced: { instrument: string; reason: string }[] = [];
  for (const r of results) {
    if ('obs' in r && r.obs) observations.push(r.obs);
    else unpriced.push({ instrument: r.inst.symbol, reason: 'error' in r ? r.error : 'unknown' });
  }
  if (observations.length === 0) return null;
  return { observations, unpriced, retrievedAtMs: d.now() };
}

export type OverviewOutcome =
  | { kind: 'ok'; result: Extract<MarketOverviewResult, { status: 'available' }> }
  | { kind: 'unavailable' };

export function createOverviewCache(d: OverviewDeps) {
  let lastGood: Batch | null = null;
  let inflight: Promise<Batch | null> | null = null;
  let lastAttemptAt = -Infinity;

  const toAvailable = (batch: Batch, stale: boolean) => ({
    status: 'available' as const,
    source: 'DexScreener' as const,
    observations: batch.observations,
    unpriced: batch.unpriced,
    stale,
    retrievedAt: new Date(batch.retrievedAtMs).toISOString(),
    cacheAgeSeconds: Math.max(0, Math.round((d.now() - batch.retrievedAtMs) / 1000)),
    staleAfterSeconds: Math.round(d.ttlMs / 1000),
  });

  async function read(force: boolean): Promise<OverviewOutcome> {
    const now = d.now();
    // Fresh cache: serve without any upstream call. An explicit refresh bypasses this,
    // subject to the spacing rule below.
    if (!force && lastGood && now - lastGood.retrievedAtMs < d.ttlMs)
      return { kind: 'ok', result: toAvailable(lastGood, false) };
    // A batch already running covers every concurrent reader.
    if (inflight) return finish(await inflight);
    // A forced refresh is spaced out per isolate; a plain read past TTL always re-fetches once.
    if (force && now - lastAttemptAt < d.minRefreshIntervalMs) {
      if (lastGood)
        return { kind: 'ok', result: toAvailable(lastGood, now - lastGood.retrievedAtMs >= d.ttlMs) };
      return { kind: 'unavailable' };
    }
    {
      lastAttemptAt = now;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), d.deadlineMs);
      inflight = runBatch(d, ctl.signal).finally(() => {
        clearTimeout(timer);
        inflight = null;
      });
    }
    return finish(await inflight);
  }

  function finish(batch: Batch | null): OverviewOutcome {
    if (batch) {
      lastGood = batch;
      return { kind: 'ok', result: toAvailable(batch, false) };
    }
    if (lastGood && d.now() - lastGood.retrievedAtMs < d.maxStaleMs)
      return { kind: 'ok', result: toAvailable(lastGood, true) };
    return { kind: 'unavailable' };
  }

  return { read };
}

/** Process-wide cache: per-isolate, best-effort, no durable layer (deliberately not D1). */
let shared: ReturnType<typeof createOverviewCache> | null = null;
export function sharedOverviewCache(): ReturnType<typeof createOverviewCache> {
  if (!shared) shared = createOverviewCache(defaultOverviewDeps());
  return shared;
}
