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
  )
    return {
      kind: 'ok',
      at: b.latestCompleteObservedAt,
      newerPartial: b.newerPartial === true,
      latest: b.latest as ObservedAmount[],
      prior: Array.isArray(b.prior) ? (b.prior as ObservedAmount[]) : null,
    };
  return { kind: 'failed' };
}

let inFlight: Promise<OverviewResult> | null = null;

/** One shared in-flight request; each call joins the same promise. */
export function fetchOverview(): Promise<OverviewResult> {
  if (!inFlight) {
    inFlight = overviewHistoryRequest()
      .then(mapOverviewResponse)
      .catch((): OverviewResult => ({ kind: 'failed' }));
    const clear = () => {
      inFlight = null;
    };
    inFlight.then(clear, clear);
  }
  return inFlight;
}
