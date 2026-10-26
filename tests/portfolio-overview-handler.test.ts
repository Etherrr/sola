import { describe, it, expect, beforeEach } from 'vitest';
import { tick } from './helpers/tick';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { handlePortfolioView } from '../server/portfolio/views-handler';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import { grantSnapshotConsent, recordObservation } from '../server/portfolio/snapshots';
import type { ProviderResult } from '../server/portfolio/provider';

let db: ReturnType<typeof createSqliteD1>['db'];
let raw: ReturnType<typeof createSqliteD1>['raw'];
let cookie: string;
const NOW = new Date().toISOString();
const OBS = '2026-10-25T12:00:00.000Z';
const OBS2 = '2026-10-25T13:00:00.000Z';

beforeEach(async () => {
  ({ db, raw } = createSqliteD1());
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(NOW, NOW).run();
  await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('i1','u1','email','invited@x.co',?)").bind(NOW).run();
  await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES ('e1','invited@x.co','owner',?)").bind(NOW).run();
  await db.prepare("INSERT INTO portfolios (id, user_id, display_prefs, created_at) VALUES ('pf1','u1',NULL,?)").bind(NOW).run();
  const s = await createSession(db, 'u1');
  cookie = `${SESSION_COOKIE}=${s.id}`;
});

const envOn = () => ({ PORTFOLIO_ACCOUNTS: '1', PORTFOLIO_ACCOUNTS_DB: db });
const call = () =>
  handlePortfolioView(
    new Request('https://app.test/api/v1/portfolio/overview', { method: 'GET', headers: { cookie } }),
    envOn(),
    'overview',
  );

type Ok = Extract<ProviderResult, { ok: true }>;
const wallet = (amount: string, price: string | null, observedAt: string): Ok => ({
  ok: true, provider: 'test-provider', simulated: false, observedAt,
  wallets: [{
    address: '0xABC', partial: false, warnings: [],
    assets: [{
      assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18,
      rawAmount: '0', amount, price, value: '0',
      priceSource: price ? 'chainlink' : null, priceObservedAt: price ? observedAt : null,
    }],
    aave: undefined,
  }],
});
const aaveRun = (suppliedUsd: string | null, debtUsd: string | null, observedAt: string): Ok => ({
  ok: true, provider: 'test-provider', simulated: false, observedAt,
  wallets: [{
    address: '0xABC', partial: false, warnings: [], assets: [],
    aave: {
      status: 'ok' as const,
      positions: [{
        underlyingAsset: '0xWETH', symbol: 'WETH', decimals: 18,
        supplied: '2', variableDebt: '1',
        suppliedValueUsd: suppliedUsd, variableDebtValueUsd: debtUsd,
        priceSource: 'chainlink', priceObservedAt: observedAt, observedAt,
        usageAsCollateralEnabled: true, reserveNote: null,
      }],
    },
  }],
});
const zeroRun = (observedAt: string): Ok => ({
  ok: true, provider: 'test-provider', simulated: false, observedAt,
  wallets: [{ address: '0xABC', partial: false, warnings: [], assets: [], aave: undefined }],
});

type SeriesPoint = { runId: string; requestedAt: string; observedAt: string; pricedSubtotalUsd: string; unpricedCount: number; staleCount: number; legacy: boolean };
type OverviewBody = {
  status: string; reason?: string;
  recordedRunMembership?: string;
  totals?: { grossPricedUsd: string | null; grossPartial: boolean; debtState: string; recordedDebtUsd: string | null; netUsd: string | null; netPartial: boolean; unpricedAssetCount: number };
  allocation?: { byNetwork: { label: string; valueUsd: string; sharePct: string }[]; byCategory: { label: string; valueUsd: string; sharePct: string }[] };
  history?: { network: string; points: SeriesPoint[] }[];
};

describe('overview view (plan 6.1, verdict A1-A5 + PIN1-3)', () => {
  it('no observations -> no_recorded_observations, no history (A2a)', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    const body = (await (await call()).json()) as OverviewBody;
    expect(body).toMatchObject({ status: 'empty', reason: 'no_recorded_observations' });
    expect(body.history).toBeUndefined();
  });

  it('priced run: gross/debt/net figures + history point is the ACTUAL run (A1/A4)', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', wallet('1.5', '2000', OBS));
    const body = (await (await call()).json()) as OverviewBody;
    expect(body.status).toBe('ok');
    expect(body.totals).toMatchObject({ grossPricedUsd: '3000', grossPartial: false, debtState: 'none', recordedDebtUsd: null, netUsd: '3000' });
    const hist = body.history!;
    expect(hist).toHaveLength(1);
    expect(hist[0].network).toBe('ethereum');
    expect(hist[0].points).toHaveLength(1);
    const pt = hist[0].points[0];
    expect(pt.observedAt).toBe(OBS);          // A4: x value is the observation instant
    expect(pt.pricedSubtotalUsd).toBe('3000');
    expect(pt.legacy).toBe(false);
    expect(pt.runId).toBeTruthy();
  });

  it('history: two runs chronological; a complete ZERO-ROW run plots at 0 - no resurrection on the time axis (A1/R2)', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', wallet('1.5', '2000', OBS));
    await tick();
    await recordObservation(db, 'u1', 'ethereum', zeroRun(OBS2));
    const body = (await (await call()).json()) as OverviewBody;
    // Headline: emptied wallet is the no_holdings_recorded state, NOT $0 and NOT stale 1.5 ETH
    expect(body.status).toBe('empty');
    expect(body.reason).toBe('no_holdings_recorded');
    // A1: history still served; earlier run stays visible, zero-row run plots at 0
    const pts = body.history![0].points;
    expect(pts).toHaveLength(2);
    expect(pts[0].pricedSubtotalUsd).toBe('3000');
    expect(pts[0].observedAt).toBe(OBS);
    expect(pts[1].pricedSubtotalUsd).toBe('0');
    expect(pts[1].observedAt).toBe(OBS2);
  });

  it('PIN3: same-instant runs persist as DISTINCT points keyed by run id, later-in-order wins going forward', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', wallet('1.5', '2000', OBS));
    await tick();
    await recordObservation(db, 'u1', 'ethereum', zeroRun(OBS)); // same observedAt, later requested_at
    const body = (await (await call()).json()) as OverviewBody;
    const pts = body.history![0].points;
    expect(pts).toHaveLength(2);                       // no dedup by instant
    expect(new Set(pts.map((p) => p.runId)).size).toBe(2);
    expect(pts[0].observedAt).toBe(OBS);
    expect(pts[1].observedAt).toBe(OBS);
    expect(pts[0].requestedAt < pts[1].requestedAt).toBe(true);
    expect(pts[1].pricedSubtotalUsd).toBe('0');        // the same-instant removal is the last point
  });

  it('A1: partial runs NEVER enter the series', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', wallet('1.5', '2000', OBS));
    await tick();
    const partial: Ok = { ...wallet('2', '2000', OBS2), wallets: [{ ...wallet('2', '2000', OBS2).wallets[0], partial: true }] };
    await recordObservation(db, 'u1', 'ethereum', partial);
    const body = (await (await call()).json()) as OverviewBody;
    const pts = body.history![0].points;
    expect(pts).toHaveLength(1);
    expect(pts[0].observedAt).toBe(OBS);
  });

  it('A3: unpriced debt suppresses net entirely on the wire; gross unaffected', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', aaveRun('4000', null, OBS));
    const body = (await (await call()).json()) as OverviewBody;
    expect(body.totals).toMatchObject({ grossPricedUsd: '4000', debtState: 'partially_unknown', recordedDebtUsd: null, netUsd: null });
    // A3: debt never enters the history series either
    expect(body.history![0].points[0].pricedSubtotalUsd).toBe('4000');
  });

  it('PIN1c: supplied row unpriced (debt priced) -> gross null "unavailable", NOT the PIN1a observed-empty 0 (unit file owns the true debt-only case)', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', aaveRun(null, '1000', OBS));
    const body = (await (await call()).json()) as OverviewBody;
    expect(body.totals?.grossPricedUsd).toBeNull();
    expect(body.totals?.unpricedAssetCount).toBe(1);
    expect(body.totals?.debtState).toBe('priced');
    expect(body.totals?.netUsd).toBeNull(); // gross unknown -> net suppressed even with priced debt
  });

  it('A5: allocation shares over the SAME gross priced denominator on both axes; debt excluded', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    const both: Ok = {
      ...wallet('1.5', '2000', OBS),
      wallets: [{ ...wallet('1.5', '2000', OBS).wallets[0], aave: aaveRun('4000', '1000', OBS).wallets[0].aave }],
    };
    await recordObservation(db, 'u1', 'ethereum', both);
    const body = (await (await call()).json()) as OverviewBody;
    const cat = Object.fromEntries(body.allocation!.byCategory.map((r) => [r.label, r]));
    expect(cat.spot.sharePct).toBe('42.86');   // 3000 / 7000
    expect(cat.supplied.sharePct).toBe('57.14');
    expect(cat.debt).toBeUndefined();
    expect(body.allocation!.byNetwork[0]).toMatchObject({ label: 'ethereum', valueUsd: '7000', sharePct: '100' });
    expect(body.totals).toMatchObject({ grossPricedUsd: '7000', recordedDebtUsd: '1000', netUsd: '6000' });
  });

  it('A2c: all asset rows unpriced -> gross null with named count, never $0', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', wallet('1.5', null, OBS));
    const body = (await (await call()).json()) as OverviewBody;
    expect(body.totals?.grossPricedUsd).toBeNull();
    expect(body.totals?.unpricedAssetCount).toBe(1);
    // A1: unpriced rows still count on the point, subtotal '0' is NOT plotted as a value story
    const pt = body.history![0].points[0];
    expect(pt.pricedSubtotalUsd).toBe('0');
    expect(pt.unpricedCount).toBe(1);
  });

  it('A1: legacy-era runs enter the series FLAGGED, never silently mixed', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', wallet('1.5', '2000', OBS));
    raw.prepare('UPDATE sync_runs SET network = NULL, observed_at = NULL').run(); // legacy era
    await tick();
    await recordObservation(db, 'u1', 'ethereum', wallet('1', '2000', OBS2));
    const body = (await (await call()).json()) as OverviewBody;
    const pts = body.history![0].points;
    expect(pts).toHaveLength(2);
    expect(pts[0].legacy).toBe(true);
    expect(pts[0].pricedSubtotalUsd).toBe('3000');
    expect(pts[1].legacy).toBe(false);
    expect(pts[1].pricedSubtotalUsd).toBe('2000');
    expect(body.recordedRunMembership).toBe('exact'); // membership labels the SERVING baseline (new-era latest); the legacy history point carries its own flag
  });

  it('multi-network: one series per network, no synthetic combined line (A1)', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', wallet('1.5', '2000', OBS));
    await tick();
    await recordObservation(db, 'u1', 'solana', {
      ok: true, provider: 'test-provider', simulated: false, observedAt: OBS2,
      wallets: [{
        address: 'So1ana', partial: false, warnings: [],
        assets: [{ assetId: 'solana/native', symbol: 'SOL', decimals: 9, rawAmount: '0', amount: '10', price: '100', value: '0', priceSource: 'chainlink', priceObservedAt: OBS2 }],
        aave: undefined,
      }],
    });
    const body = (await (await call()).json()) as OverviewBody;
    expect(body.history).toHaveLength(2);
    const nets = body.history!.map((h) => h.network).sort();
    expect(nets).toEqual(['ethereum', 'solana']);
    for (const h of body.history!) expect(h.points).toHaveLength(1);
  });
});
