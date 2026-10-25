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
