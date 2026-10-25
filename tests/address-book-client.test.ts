import { describe, expect, it } from 'vitest';
import { statusOf } from '../features/portfolio-v2/address-book';

/** The address-book client must read the limiter's ACTUAL 429 shape:
 *  body {error:'rate_limited', retryAfterSec} with NO Retry-After header
 *  (server/portfolio/addresses.ts). Reviewer 2026-10-25: a client reading
 *  `retryAfter`/the header would never surface the retry hint. */
describe('address book rate-limit state mapping', () => {
  it('surfaces retryAfterSec from the 429 body', async () => {
    const res = new Response(JSON.stringify({ error: 'rate_limited', retryAfterSec: 42 }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
    const s = await statusOf(res);
    expect(s).toEqual({ kind: 'failed', retryAfter: 42 });
  });

  it('still maps a header-less, malformed 429 to an honest failed state', async () => {
    const res = new Response('nope', { status: 429 });
    const s = await statusOf(res);
    expect(s).toEqual({ kind: 'failed', retryAfter: undefined });
  });

  it('keeps the other state mappings exact', async () => {
    expect(await statusOf(new Response('{}', { status: 401 }))).toEqual({ kind: 'signin' });
    expect(await statusOf(new Response('{}', { status: 503 }))).toEqual({ kind: 'off' });
    expect(await statusOf(new Response('{}', { status: 500 }))).toEqual({ kind: 'failed' });
    const ok = new Response(JSON.stringify({ status: 'ok', addresses: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    expect(await statusOf(ok)).toEqual({ kind: 'ok', addresses: [] });
  });
});

import { mapOverviewResponse } from '../features/portfolio-v2/overview-history';

/** Reviewer alignment rule (2026-10-25): 403 is its own state - a LIVE session
 *  whose email is not on the invite list must never be told to "sign in". */
describe('overview history response mapping', () => {
  it('maps 403 to notinvited, never signin', async () => {
    expect(await mapOverviewResponse(new Response('{}', { status: 403 }))).toEqual({
      kind: 'notinvited',
    });
  });
  it('maps 401 to signin, 503 to off, other errors to failed', async () => {
    expect(await mapOverviewResponse(new Response('{}', { status: 401 }))).toEqual({ kind: 'signin' });
    expect(await mapOverviewResponse(new Response('{}', { status: 503 }))).toEqual({ kind: 'off' });
    expect(await mapOverviewResponse(new Response('{}', { status: 500 }))).toEqual({ kind: 'failed' });
  });
  it('passes through the ok payload with the complete-observation label fields', async () => {
    const latest = [{ assetId: 'eth/native', network: 'ethereum', address: '0xAbC', kind: 'native', amount: '1.5', observedAt: '2026-10-25T00:00:00Z' }];
    const res = new Response(
      JSON.stringify({ status: 'ok', scope: 'spot_balances_only', latestCompleteObservedAt: '2026-10-25T00:00:00Z', newerPartial: true, latest, prior: null }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    expect(await mapOverviewResponse(res)).toEqual({
      kind: 'ok', at: '2026-10-25T00:00:00Z', newerPartial: true, latest, prior: null,
    });
  });
});
