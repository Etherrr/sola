import { describe, it, expect } from 'vitest';
import { mapConsentResponse, mapSyncResponse } from '../features/portfolio-v2/snapshot-sync';

const res = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('consent response mapping', () => {
  it('maps every documented state honestly', async () => {
    expect(await mapConsentResponse(res(401))).toEqual({ kind: 'signin' });
    expect(await mapConsentResponse(res(403))).toEqual({ kind: 'notinvited' });
    expect(await mapConsentResponse(res(503))).toEqual({ kind: 'off' });
    expect(await mapConsentResponse(res(500))).toEqual({ kind: 'failed' });
    expect(await mapConsentResponse(res(200, { status: 'ok', consented: true }))).toEqual({ kind: 'ok', consented: true });
    expect(await mapConsentResponse(res(200, { status: 'ok', consented: false }))).toEqual({ kind: 'ok', consented: false });
    // a malformed 200 is a failure, never a guessed state
    expect(await mapConsentResponse(res(200, { status: 'ok' }))).toEqual({ kind: 'failed' });
  });
});

describe('sync response mapping', () => {
  it('maps gates and honest reasons', async () => {
    expect(await mapSyncResponse(res(401))).toEqual({ kind: 'signin' });
    expect(await mapSyncResponse(res(403))).toEqual({ kind: 'notinvited' });
    expect(await mapSyncResponse(res(503))).toEqual({ kind: 'off' });
    expect(await mapSyncResponse(res(429, { retryAfterSec: 42 }))).toEqual({ kind: 'limited', retryAfterSec: 42 });
    expect(await mapSyncResponse(res(200, { status: 'ok', recorded: false, reason: 'no_consent' }))).toEqual({ kind: 'no_consent' });
    expect(await mapSyncResponse(res(200, { status: 'ok', recorded: false, reason: 'no_addresses' }))).toEqual({ kind: 'no_addresses' });
    expect(await mapSyncResponse(res(500))).toEqual({ kind: 'failed' });
  });

  it('per-network failures become named notes; simulated reads are called out', async () => {
    const out = await mapSyncResponse(res(200, {
      status: 'ok',
      recorded: true,
      runs: [
        { network: 'ethereum', recorded: true },
        { network: 'solana', recorded: false, reason: 'timeout' },
      ],
    }));
    expect(out).toEqual({ kind: 'ok', recorded: true, notes: ['solana: read failed (timeout) - not recorded'] });
    const sim = await mapSyncResponse(res(200, {
      status: 'ok',
      recorded: false,
      runs: [{ network: 'ethereum', recorded: false, reason: 'simulated_refused' }],
    }));
    expect(sim).toEqual({ kind: 'ok', recorded: false, notes: ['ethereum: read was simulated - not recorded'] });
    // a 200 without runs is a failure shape, not a fake success
    expect(await mapSyncResponse(res(200, { status: 'ok', recorded: true }))).toEqual({ kind: 'failed' });
  });
});
