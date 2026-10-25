import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupAddress, retryAfterSeconds } from '../features/portfolio/api-client';

afterEach(() => vi.unstubAllGlobals());
describe('explicit retry timing', () => {
  it('honors seconds and HTTP dates, including expired dates', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    expect(retryAfterSeconds('90', now)).toBe(90);
    expect(retryAfterSeconds('Sat, 24 Oct 2026 12:01:30 GMT', now)).toBe(90);
    expect(retryAfterSeconds('Sat, 24 Oct 2026 11:59:30 GMT', now)).toBe(0);
    expect(retryAfterSeconds('0', now)).toBe(0);
  });
  it.each([null, '', 'bad', '-1', '1.5', '999999999999999999999999'])(
    'uses a safe fallback for %s',
    (value) => {
      expect(retryAfterSeconds(value)).toBe(30);
    },
  );
  it('carries 429 timing without making a second request or substituting balances', async () => {
    const fetcher = vi.fn(
      async () => new Response('{}', { status: 429, headers: { 'retry-after': '60' } }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await lookupAddress('synthetic-address', 'solana');
    expect(result).toMatchObject({ kind: 'error', retryable: true, retryAfterSeconds: 60 });
    expect(result).not.toHaveProperty('data');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not offer retry for expired authentication', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
    expect(await lookupAddress('synthetic-address')).toMatchObject({
      kind: 'error',
      retryable: false,
    });
  });
  it('forwards cancellation and releases its caller listener', async () => {
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    vi.stubGlobal(
      'fetch',
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = lookupAddress('synthetic-address', 'solana', caller.signal);
    caller.abort();
    expect(await pending).toMatchObject({ kind: 'error' });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('lookup response ownership and clocks', () => {
  const address = '0x1111111111111111111111111111111111111110'; // synthetic fixture
  const body = {
    schemaVersion: 1,
    mode: 'live',
    simulated: false,
    provider: 'synthetic-test-provider',
    generatedAt: '2026-10-24T12:01:00Z',
    observedAt: '2026-10-24T12:00:00Z',
    wallets: [{ address, assets: [], partial: false, warnings: [] }],
    totals: {
      recognizedPricedSubtotalUsd: null,
      unpricedAssetCount: 0,
      note: 'Synthetic test only',
    },
    partial: false,
    warnings: [],
  };
  it('rejects unrequested extra wallets instead of displaying other address data', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        ...body,
        wallets: [...body.wallets, { ...body.wallets[0], address: 'unrequested' }],
      }),
    );
    expect(await lookupAddress(address)).toMatchObject({ kind: 'error' });
  });
  it('rejects unusable observation clocks instead of publishing a false time label', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ ...body, observedAt: 'not-a-time' }));
    expect(await lookupAddress(address)).toMatchObject({ kind: 'error' });
  });
});
