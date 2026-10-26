'use client';
import { overviewHistoryRequest } from '../portfolio/api-client';

/**
 * Shared overview-history fetch for the v0.2 Overview panels: Holdings and
 * What-changed need the SAME payload, so one in-flight request serves both
 * (reviewer 2026-10-25: two identical requests on mount). Consumers map the
 * normalized result; no component ever reads the Response twice.
 *
 * 403 is its own state: the session is LIVE but the email is not on the
 * invite list - mapping it to "sign in" would lie (reviewer alignment rule).
 */

export type ObservedAmount = {
  assetId: string;
  network: 'ethereum' | 'solana';
  address: string;
  kind: string;
  amount: string;
  observedAt: string;
};

export type NetworkSlice = {
  network: 'ethereum' | 'solana';
  /** This network's own latest COMPLETE observation time - the only honest
   *  baseline for its deltas (reviewer MEDIUM). */
  at: string;
  latest: ObservedAmount[];
  prior: ObservedAmount[] | null;
};

export type OverviewResult =
  | { kind: 'signin' }
  | { kind: 'notinvited' }
  | { kind: 'off' }
  | { kind: 'failed' }
  | { kind: 'empty'; newerPartial: boolean }
  | {
      kind: 'ok';
      at: string;
      newerPartial: boolean;
      latest: ObservedAmount[];
      prior: ObservedAmount[] | null;
      /** Per-network slices; Solana rows cover the SOL balance only. */
      networks: NetworkSlice[];
      /** 'exact' = recorded-run membership only (every serving run owns its
       *  rows) - NOT portfolio completeness or valuation truth.
       *  'best_effort_legacy' = a pre-run-tracking baseline may under-serve;
       *  show the caveat. */
      recordedRunMembership: 'exact' | 'best_effort_legacy';
    };

/** Pure response mapping, exported for tests. */
export async function mapOverviewResponse(res: Response): Promise<OverviewResult> {
  if (res.status === 401) return { kind: 'signin' };
  if (res.status === 403) return { kind: 'notinvited' };
  if (res.status === 503) return { kind: 'off' };
  if (!res.ok) return { kind: 'failed' };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: 'failed' };
  }
  const b = body as Record<string, unknown>;
  if (b?.status === 'empty')
    return { kind: 'empty', newerPartial: b.newerPartial === true };
  if (
    b?.status === 'ok' &&
    typeof b.latestCompleteObservedAt === 'string' &&
    Array.isArray(b.latest)
  ) {
    // Per-network slices are the only honest delta baseline. A missing or
    // malformed networks[] is a broken payload: FAIL rather than silently
    // falling back to merged rows (reviewer requirement).
    if (!Array.isArray(b.networks)) return { kind: 'failed' };
    const rawSlices = b.networks as Array<Record<string, unknown>>;
    if (
      rawSlices.some(
        (n) =>
          !n ||
          (n.network !== 'ethereum' && n.network !== 'solana') ||
          typeof n.latestObservedAt !== 'string' ||
          !Array.isArray(n.latest) ||
          (n.prior !== null && n.prior !== undefined && !Array.isArray(n.prior)),
      )
    )
      return { kind: 'failed' };
    const networks: NetworkSlice[] = rawSlices.map((n) => ({
      network: n.network as 'ethereum' | 'solana',
      at: n.latestObservedAt as string,
      latest: n.latest as ObservedAmount[],
      prior: Array.isArray(n.prior) ? (n.prior as ObservedAmount[]) : null,
    }));
    // Recorded-run membership marker (2026-10-26): legacy-era baselines may
    // UNDER-SERVE holdings/diffs; consumers must show the caveat. A missing
    // or unknown value is a broken payload - fail, never silently exact.
    const m = b.recordedRunMembership;
    if (m !== 'exact' && m !== 'best_effort_legacy') return { kind: 'failed' };
    return {
      kind: 'ok',
      at: b.latestCompleteObservedAt,
      newerPartial: b.newerPartial === true,
      latest: b.latest as ObservedAmount[],
      prior: Array.isArray(b.prior) ? (b.prior as ObservedAmount[]) : null,
      networks,
      recordedRunMembership: m,
    };
  }
  return { kind: 'failed' };
}

let inFlight: Promise<OverviewResult> | null = null;

/** One shared in-flight request; each call joins the same promise. */
export function fetchOverview(): Promise<OverviewResult> {
  if (!inFlight) {
    const p = overviewHistoryRequest()
      .then(mapOverviewResponse)
      .catch((): OverviewResult => ({ kind: 'failed' }));
    inFlight = p;
    // Identity-guarded: a superseded request must not clear a newer one.
    const clear = () => {
      if (inFlight === p) inFlight = null;
    };
    p.then(clear, clear);
  }
  return inFlight;
}

/**
 * Recorded balances changed (sync, refresh, recording withdrawal): drop the
 * shared in-flight request so no caller can join a pre-change response.
 * Callers must also discard their own pending .then results (generation
 * guard) - a promise already handed out still resolves.
 */
export function invalidateOverview(): void {
  inFlight = null;
}

/** Rows of a normalized overview payload belonging to ONE address.
 *  Case-aware: EVM hex compares case-insensitively, Solana base58 exactly. */
export function rowsForAddress(
  rows: ObservedAmount[],
  network: 'ethereum' | 'solana',
  address: string,
): ObservedAmount[] {
  const want = network === 'ethereum' ? address.toLowerCase() : address;
  return rows.filter(
    (r) =>
      r.network === network &&
      (network === 'ethereum' ? r.address.toLowerCase() : r.address) === want,
  );
}
