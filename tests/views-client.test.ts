import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAssets, fetchPositions, fetchRisk } from '../features/portfolio-v2/views-client';

/** Recorded view client mapping (plan 6.2-6.4): fail-closed on malformed
 *  payloads; marker REQUIRED on ok, TOLERATED absent on empty (reviewer
 *  consumer note: no_recorded_observations carries no marker). */
const NETS = [{ network: 'eip155:1', address: '0xabc', latestObservedAt: '2026-10-26T08:00:00Z' }];
const BASE = {
  status: 'ok',
  scope: 'recorded_observations_only',
  coverage: 'spot_balances_and_recorded_aave_v3_only',
  solanaScope: 'sol_only',
  latestCompleteObservedAt: '2026-10-26T08:00:00Z',
  newerPartial: false,
  newerUnattributed: false,
  networks: NETS,
  recordedRunMembership: 'exact',
};
// Wire values are DECIMAL STRINGS end to end (read-model.ts); the client
// must validate them as strings and never convert through floats.
const ASSET = {
  assetId: 'eip155:1/native',
  symbol: 'ETH',
  network: 'eip155:1',
  address: '0xabc',
  kind: 'wallet_balance',
  amount: '1.5',
  priceUsd: '3000',
  valueUsd: '4500',
  shareOfPricedPct: '100',
  observedAt: '2026-10-26T08:00:00Z',
  source: 'defichain',
  priceStale: false,
};
const POSITION = {
  protocol: 'aave_v3',
  network: 'eip155:1',
  address: '0xabc',
  assetId: 'eip155:1/erc20:0xUSDC',
  symbol: 'USDC',
  supplied: '100',
  debt: '40',
  net: '60',
  suppliedValueUsd: '100',
  debtValueUsd: '40',
  priceStale: false,
  observedAt: '2026-10-26T08:00:00Z',
};
const RISK = {
  byChain: [{ label: 'eip155:1', valueUsd: '4500', sharePct: '100' }],
  byAsset: [{ label: 'ETH', valueUsd: '4500', sharePct: '100' }],
  byProtocol: [],
  debtToKnownAssets: '0.4',
  stablecoinSharePct: '25',
  partial: true,
};
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const stubFetch = (res: Response) => {
  vi.stubGlobal('fetch', vi.fn(async () => res));
};
afterEach(() => vi.unstubAllGlobals());

describe('recorded view client mapping', () => {
  it('maps an ok assets payload and preserves the membership marker', async () => {
    stubFetch(ok({ ...BASE, rows: [ASSET] }));
    const r = await fetchAssets();
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.rows).toHaveLength(1);
    expect(r.recordedRunMembership).toBe('exact');
    expect(r.at).toBe('2026-10-26T08:00:00Z');
  });

  it('fails closed on ok payloads with a missing or unknown marker', async () => {
    const noMarker: Record<string, unknown> = { ...BASE };
    delete noMarker.recordedRunMembership;
    stubFetch(ok({ ...noMarker, rows: [ASSET] }));
    expect((await fetchAssets()).kind).toBe('failed');
    stubFetch(ok({ ...BASE, recordedRunMembership: 'precise', rows: [ASSET] }));
    expect((await fetchAssets()).kind).toBe('failed');
  });

  it('tolerates a missing marker on empty no_recorded_observations', async () => {
    stubFetch(ok({ status: 'empty', reason: 'no_recorded_observations', newerPartial: false, newerUnattributed: true }));
    const r = await fetchAssets();
    expect(r).toEqual({
      kind: 'empty',
      reason: 'no_recorded_observations',
      newerPartial: false,
      newerUnattributed: true,
      recordedRunMembership: null,
    });
  });

  it('keeps the marker on empty no_holdings_recorded and rejects a present-but-unknown one', async () => {
    stubFetch(
      ok({
        status: 'empty',
        reason: 'no_holdings_recorded',
        newerPartial: false,
        newerUnattributed: false,
        recordedRunMembership: 'best_effort_legacy',
      }),
    );
    const r = await fetchPositions();
    expect(r.kind).toBe('empty');
    if (r.kind === 'empty') expect(r.recordedRunMembership).toBe('best_effort_legacy');
    stubFetch(
      ok({
        status: 'empty',
        reason: 'no_holdings_recorded',
        newerPartial: false,
        newerUnattributed: false,
        recordedRunMembership: 'sort_of',
      }),
    );
    expect((await fetchPositions()).kind).toBe('failed');
  });

  it('maps status codes to their honest states', async () => {
    stubFetch(new Response('{}', { status: 401 }));
    expect((await fetchRisk()).kind).toBe('signin');
    stubFetch(new Response('{}', { status: 403 }));
    expect((await fetchRisk()).kind).toBe('notinvited');
    stubFetch(new Response('{}', { status: 503 }));
    expect((await fetchRisk()).kind).toBe('off');
    stubFetch(new Response('{}', { status: 500 }));
    expect((await fetchRisk()).kind).toBe('failed');
    stubFetch(new Response('not json', { status: 200 }));
    expect((await fetchRisk()).kind).toBe('failed');
  });

  it('fails closed on a malformed row instead of dropping it silently', async () => {
    stubFetch(ok({ ...BASE, rows: [{ ...ASSET, amount: 'lots' }] }));
    expect((await fetchAssets()).kind).toBe('failed');
    // A NUMBER where the wire contract says decimal string also fails closed -
    // JSON numeric payloads are not this API's shape.
    stubFetch(ok({ ...BASE, rows: [{ ...ASSET, amount: 1.5 }] }));
    expect((await fetchAssets()).kind).toBe('failed');
    stubFetch(ok({ ...BASE, rows: [{ ...POSITION, net: undefined }] }));
    expect((await fetchPositions()).kind).toBe('failed');
    stubFetch(ok({ ...BASE, risk: { ...RISK, debtToKnownAssets: 0.4 } }));
    expect((await fetchRisk()).kind).toBe('failed');
  });

  it('maps an ok risk payload and fails closed on a malformed risk object', async () => {
    stubFetch(ok({ ...BASE, risk: RISK }));
    const r = await fetchRisk();
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.risk.partial).toBe(true);
    expect(r.risk.byChain[0]).toEqual({ label: 'eip155:1', valueUsd: '4500', sharePct: '100' });
    stubFetch(ok({ ...BASE, risk: { ...RISK, byChain: 'eth' } }));
    expect((await fetchRisk()).kind).toBe('failed');
  });

  it('keeps null USD figures as null (Unknown), never zero', async () => {
    stubFetch(ok({ ...BASE, rows: [{ ...ASSET, priceUsd: null, valueUsd: null, shareOfPricedPct: null }] }));
    const r = await fetchAssets();
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.rows[0]!.priceUsd).toBeNull();
    expect(r.rows[0]!.valueUsd).toBeNull();
  });
});
