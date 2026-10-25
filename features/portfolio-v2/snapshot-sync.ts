'use client';
import {
  snapshotConsentStatusRequest,
  snapshotConsentChangeRequest,
  syncRequest,
} from '../portfolio/api-client';

/**
 * Observation consent + sync mapping for the v0.2 Overview. Pure response
 * mapping, exported for tests. Every state honest: 403 (live session, not
 * invited) is NEVER shown as "sign in" (reviewer alignment rule).
 */

export type ConsentState =
  | { kind: 'signin' }
  | { kind: 'notinvited' }
  | { kind: 'off' }
  | { kind: 'failed' }
  | { kind: 'ok'; consented: boolean };

export async function mapConsentResponse(res: Response): Promise<ConsentState> {
  if (res.status === 401) return { kind: 'signin' };
  if (res.status === 403) return { kind: 'notinvited' };
  if (res.status === 503) return { kind: 'off' };
  if (!res.ok) return { kind: 'failed' };
  try {
    const b = (await res.json()) as { consented?: boolean };
    if (typeof b.consented !== 'boolean') return { kind: 'failed' };
    return { kind: 'ok', consented: b.consented };
  } catch {
    return { kind: 'failed' };
  }
}

export const loadConsent = async (signal?: AbortSignal): Promise<ConsentState> => {
  try {
    return await mapConsentResponse(await snapshotConsentStatusRequest(signal));
  } catch {
    return { kind: 'failed' };
  }
};

export const changeConsent = async (action: 'grant' | 'withdraw'): Promise<ConsentState> => {
  try {
    return await mapConsentResponse(await snapshotConsentChangeRequest(action));
  } catch {
    return { kind: 'failed' };
  }
};

export type SyncOutcome =
  | { kind: 'signin' }
  | { kind: 'notinvited' }
  | { kind: 'off' }
  | { kind: 'limited'; retryAfterSec: number }
  | { kind: 'failed' }
  | { kind: 'no_consent' }
  | { kind: 'no_addresses' }
  | { kind: 'ok'; recorded: boolean; notes: string[] };

/** Per-network run entries become terse honest notes; never a fake success. */
export async function mapSyncResponse(res: Response): Promise<SyncOutcome> {
  if (res.status === 401) return { kind: 'signin' };
  if (res.status === 403) return { kind: 'notinvited' };
  if (res.status === 503) return { kind: 'off' };
  if (res.status === 429) {
    let wait = 60;
    try {
      const b = (await res.json()) as { retryAfterSec?: number };
      if (typeof b.retryAfterSec === 'number') wait = b.retryAfterSec;
    } catch { /* default wait */ }
    return { kind: 'limited', retryAfterSec: wait };
  }
  if (!res.ok) return { kind: 'failed' };
  try {
    const b = (await res.json()) as {
      recorded?: boolean;
      reason?: string;
      runs?: Array<{ network: string; recorded: boolean; reason?: string }>;
    };
    if (b.reason === 'no_consent') return { kind: 'no_consent' };
    if (b.reason === 'no_addresses') return { kind: 'no_addresses' };
    if (!Array.isArray(b.runs)) return { kind: 'failed' };
    const notes = b.runs
      .filter((r) => !r.recorded)
      .map((r) => `${r.network}: ${r.reason === 'simulated_refused' ? 'read was simulated - not recorded' : `read failed (${r.reason}) - not recorded`}`);
    return { kind: 'ok', recorded: b.recorded === true, notes };
  } catch {
    return { kind: 'failed' };
  }
}

export const runSync = async (): Promise<SyncOutcome> => {
  try {
    return await mapSyncResponse(await syncRequest());
  } catch {
    return { kind: 'failed' };
  }
};
