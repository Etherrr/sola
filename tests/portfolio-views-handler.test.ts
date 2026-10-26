import { describe, it, expect, beforeEach } from 'vitest';
import { tick } from './helpers/tick';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { handlePortfolioView, type ViewKind } from '../server/portfolio/views-handler';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import { grantSnapshotConsent, recordObservation, recordSyncError, withdrawSnapshotConsent, deleteSnapshots } from '../server/portfolio/snapshots';
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

const VIEWS: ViewKind[] = ['assets', 'positions', 'risk'];
const get = (c: string | null, view: string) =>
  new Request(`https://app.test/api/v1/portfolio/${view}`, {
    method: 'GET',
    ...(c ? { headers: { cookie: c } } : {}),
  });
const envOn = () => ({ PORTFOLIO_ACCOUNTS: '1', PORTFOLIO_ACCOUNTS_DB: db });
const call = (
  view: ViewKind,
  c: string | null = cookie,
  env: Parameters<typeof handlePortfolioView>[1] = envOn(),
) => handlePortfolioView(get(c, view), env, view);

type Fixture = {
  ethAmount?: string;
  ethPrice?: string | null;
  aave?: { supplied: string; debt: string; suppliedUsd: string | null; debtUsd: string | null };
  partial?: boolean;
  observedAt?: string;
};
const result = (f: Fixture = {}): Extract<ProviderResult, { ok: true }> => {
  const at = f.observedAt ?? OBS;
  const price = f.ethPrice === undefined ? '2000' : f.ethPrice;
  return {
    ok: true, provider: 'test-provider', simulated: false, observedAt: at,
    wallets: [{
      address: '0xABC', partial: f.partial ?? false, warnings: [],
      assets: [{
        assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18,
        rawAmount: '0', amount: f.ethAmount ?? '1.5',
        price, value: '0',
        priceSource: price ? 'chainlink' : null, priceObservedAt: price ? at : null,
      }],
      ...(f.aave
        ? {
            aave: {
              status: 'ok' as const,
              positions: [{
                underlyingAsset: '0xWETH', symbol: 'WETH', decimals: 18,
                supplied: f.aave.supplied, variableDebt: f.aave.debt,
                suppliedValueUsd: f.aave.suppliedUsd, variableDebtValueUsd: f.aave.debtUsd,
                priceSource: 'chainlink', priceObservedAt: at, observedAt: at,
                usageAsCollateralEnabled: true, reserveNote: null,
              }],
            },
          }
        : { aave: undefined }),
    }],
  };
};

describe('recorded read routes (assets / positions / risk)', () => {
  it('405 on non-GET; 503 when flag off or binding missing (all views)', async () => {
    for (const v of VIEWS) {
      expect((await handlePortfolioView(new Request('https://app.test/x', { method: 'POST' }), envOn(), v)).status).toBe(405);
      expect((await call(v, cookie, { PORTFOLIO_ACCOUNTS: '0', PORTFOLIO_ACCOUNTS_DB: db })).status).toBe(503);
      expect((await call(v, cookie, { PORTFOLIO_ACCOUNTS: '1' })).status).toBe(503);
    }
  });

  it('401 without a session; 403 without entitlement (all views)', async () => {
    for (const v of VIEWS) expect((await call(v, null)).status).toBe(401);
    await db.prepare('DELETE FROM entitlements').bind().run();
    for (const v of VIEWS) expect((await call(v)).status).toBe(403);
  });

  it('honest empty: no recorded observations -> status empty, never a zero claim (all views)', async () => {
    for (const v of VIEWS) {
      const body = (await (await call(v)).json()) as { status: string; reason: string };
      expect(body).toMatchObject({ status: 'empty', reason: 'no_recorded_observations' });
    }
  });

  it('assets: recorded balance + aave supplied, exact priced math, share of PRICED subtotal only', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ aave: { supplied: '2', debt: '0', suppliedUsd: '4000', debtUsd: '0' } }));
    const body = (await (await call('assets')).json()) as {
      status: string; scope: string; latestCompleteObservedAt: string;
      rows: { assetId: string; symbol: string; kind: string; valueUsd: string | null; shareOfPricedPct: string | null; priceStale: boolean }[];
    };
    expect(body.status).toBe('ok');
    expect(body.scope).toBe('recorded_observations_only');
    expect(body.latestCompleteObservedAt).toBe(OBS);
    const eth = body.rows.find((r) => r.assetId === 'eip155:1/native')!;
    expect(eth).toMatchObject({ symbol: 'ETH', kind: 'wallet_balance', valueUsd: '3000', shareOfPricedPct: '42.86', priceStale: false });
    const weth = body.rows.find((r) => r.symbol === 'WETH')!;
    expect(weth).toMatchObject({ kind: 'protocol_supplied', valueUsd: '4000', shareOfPricedPct: '57.14' });
  });

  it('assets: unpriced recorded asset keeps valueUsd=null and share=null - never zero-valued', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ ethPrice: null }));
    const body = (await (await call('assets')).json()) as {
      rows: { symbol: string; valueUsd: string | null; shareOfPricedPct: string | null }[];
    };
    expect(body.rows[0]).toMatchObject({ symbol: 'ETH', valueUsd: null, shareOfPricedPct: null });
  });

  it('positions: recorded aave supplied/debt sides with signed net, zero debt preserved as true zero', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ aave: { supplied: '2', debt: '0', suppliedUsd: '4000', debtUsd: '0' } }));
    const body = (await (await call('positions')).json()) as {
      rows: { protocol: string; symbol: string; supplied: string; debt: string; net: string; suppliedValueUsd: string | null }[];
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ protocol: 'aave-v3', symbol: 'WETH', supplied: '2', debt: '0', net: '2', suppliedValueUsd: '4000' });
  });

  it('risk: concentrations over fresh-priced only; debt ratio exact; no invented returns', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ aave: { supplied: '2', debt: '1', suppliedUsd: '4000', debtUsd: '2000' } }));
    const body = (await (await call('risk')).json()) as {
      risk: {
        byChain: { label: string; valueUsd: string; sharePct: string }[];
        byAsset: { label: string; sharePct: string }[];
        byProtocol: { label: string }[];
        debtToKnownAssets: string | null; stablecoinSharePct: string | null; partial: boolean;
      };
    };
    expect(body.risk.byChain).toEqual([{ label: 'ethereum', valueUsd: '7000', sharePct: '100' }]);
    expect(body.risk.byAsset.map((r) => r.label).sort()).toEqual(['ETH', 'WETH']);
    expect(body.risk.byProtocol.map((r) => r.label).sort()).toEqual(['aave-v3', 'wallet']);
    expect(body.risk.debtToKnownAssets).toBe('0.2857');
    expect(body.risk.stablecoinSharePct).toBe('0');
    expect(body.risk.partial).toBe(false);
  });

  it('risk: unpriced asset marks the whole view PARTIAL', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ ethPrice: null, aave: { supplied: '2', debt: '0', suppliedUsd: '4000', debtUsd: '0' } }));
    const body = (await (await call('risk')).json()) as { risk: { partial: boolean; debtToKnownAssets: string | null } };
    expect(body.risk.partial).toBe(true);
    expect(body.risk.debtToKnownAssets).toBe('0');
  });

  it('newerPartial: a newer PARTIAL run never serves a view but sets the honest flag', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ observedAt: OBS }));
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ observedAt: OBS2, partial: true }));
    const body = (await (await call('assets')).json()) as { latestCompleteObservedAt: string; newerPartial: boolean };
    expect(body.latestCompleteObservedAt).toBe(OBS);
    expect(body.newerPartial).toBe(true);
  });

  it('per-network baselines: a newer Solana observation carries its own timestamp', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ observedAt: OBS }));
    const sol = result({ observedAt: OBS2 });
    sol.wallets = [{
      address: 'SoLanaAddr', partial: false, warnings: [],
      assets: [{
        assetId: 'solana:mainnet/native', symbol: 'SOL', decimals: 9,
        rawAmount: '0', amount: '10', price: '100', value: '0',
        priceSource: 'chainlink', priceObservedAt: OBS2,
      }],
      aave: undefined,
    }];
    await tick();
    await recordObservation(db, 'u1', 'solana', sol);
    const body = (await (await call('assets')).json()) as {
      latestCompleteObservedAt: string;
      networks: { network: string; latestObservedAt: string }[];
      rows: { symbol: string; valueUsd: string | null }[];
    };
    expect(body.latestCompleteObservedAt).toBe(OBS2);
    expect(body.networks).toEqual([
      { network: 'ethereum', latestObservedAt: OBS },
      { network: 'solana', latestObservedAt: OBS2 },
    ]);
    expect(body.rows.find((r) => r.symbol === 'SOL')).toMatchObject({ valueUsd: '1000' });
  });

  it('consent withdrawn: history deleted, every view back to honest empty', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result());
    await deleteSnapshots(db, 'u1');
    for (const v of VIEWS) {
      const body = (await (await call(v)).json()) as { status: string };
      expect(body.status).toBe('empty');
    }
  });

  it('fail-closed: a corrupt recorded position JSON answers storage_unavailable, never fabricated figures', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ aave: { supplied: '2', debt: '0', suppliedUsd: '4000', debtUsd: '0' } }));
    raw.prepare("UPDATE position_snapshots SET position = 'not-json{{'").run();
    expect((await call('positions')).status).toBe(503);
    const body = (await (await call('positions')).json()) as { error: string };
    expect(body.error).toBe('storage_unavailable');
  });

  it('fail-closed: dropped snapshot storage answers storage_unavailable', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result());
    raw.prepare('DROP TABLE balance_snapshots').run();
    expect((await call('assets')).status).toBe(503);
  });
});

describe('recorded-data regressions (reviewer R1/R2 + amendments, 2026-10-26)', () => {
  const zeroRun = (observedAt: string, partial = false): Extract<ProviderResult, { ok: true }> => ({
    ok: true, provider: 'test-provider', simulated: false, observedAt,
    wallets: [{ address: '0xABC', partial, warnings: [], assets: [], aave: undefined }],
  });
  const wallet = (address: string, amount: string, priceObservedAt: string) => ({
    address, partial: false, warnings: [] as string[],
    assets: [{
      assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18,
      rawAmount: '0', amount, price: '2000', value: '0',
      priceSource: 'chainlink' as const, priceObservedAt,
    }],
    aave: undefined,
  });
  const makeUser = async (u: string, email: string) => {
    await db.prepare('INSERT INTO users (id, status, created_at, updated_at) VALUES (?,?,?,?)').bind(u, 'active', NOW, NOW).run();
    await db.prepare('INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES (?,?,?,?,?)').bind(`i-${u}`, u, 'email', email, NOW).run();
    await db.prepare('INSERT INTO entitlements (id, email, granted_by, created_at) VALUES (?,?,?,?)').bind(`e-${u}`, email, 'owner', NOW).run();
    await db.prepare('INSERT INTO portfolios (id, user_id, display_prefs, created_at) VALUES (?,?,NULL,?)').bind(`pf-${u}`, u, NOW).run();
    const s = await createSession(db, u);
    return `${SESSION_COOKIE}=${s.id}`;
  };

  it('R2: emptied wallet - a complete ZERO-ROW run is the baseline; prior holdings never resurrect', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ observedAt: OBS }));
    await tick();
    await recordObservation(db, 'u1', 'ethereum', zeroRun(OBS2));
    for (const v of VIEWS) {
      const body = (await (await call(v)).json()) as {
        status: string; reason: string; latestCompleteObservedAt: string;
        networks: { network: string; latestObservedAt: string }[];
      };
      expect(body.status).toBe('empty');
      expect(body.reason).toBe('no_holdings_recorded'); // NOT the stale 1.5 ETH as 'ok'
      expect(body.latestCompleteObservedAt).toBe(OBS2);
      expect(body.networks).toEqual([{ network: 'ethereum', latestObservedAt: OBS2 }]);
    }
  });

  it('R2: never-observed keeps the distinct no_recorded_observations reason', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    const body = (await (await call('assets')).json()) as { status: string; reason: string };
    expect(body).toMatchObject({ status: 'empty', reason: 'no_recorded_observations' });
  });

  it('R2: removed address - a newer complete run serves only the remaining address', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', {
      ok: true, provider: 'test-provider', simulated: false, observedAt: OBS,
      wallets: [wallet('0xAAA', '1', OBS), wallet('0xBBB', '2', OBS)],
    });
    await tick();
    await recordObservation(db, 'u1', 'ethereum', {
      ok: true, provider: 'test-provider', simulated: false, observedAt: OBS2,
      wallets: [wallet('0xAAA', '1', OBS2)],
    });
    const body = (await (await call('assets')).json()) as {
      latestCompleteObservedAt: string;
      rows: { address: string; amount: string }[];
    };
    expect(body.latestCompleteObservedAt).toBe(OBS2);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((r) => r.address !== '0xBBB')).toBe(true);
  });

  it('R1: two wallets, same asset, quotes 5s apart - holdings NEVER double-count', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', {
      ok: true, provider: 'test-provider', simulated: false, observedAt: OBS,
      wallets: [wallet('0xAAA', '1', OBS), wallet('0xBBB', '2', '2026-10-25T12:00:05.000Z')],
    });
    // both quotes remain stored (immutable recorded observations)
    const priceRows = raw.prepare('SELECT COUNT(*) AS n FROM price_observations').get() as { n: number };
    expect(priceRows.n).toBe(2);
    const body = (await (await call('assets')).json()) as {
      rows: { address: string; amount: string; valueUsd: string | null }[];
    };
    expect(body.rows).toHaveLength(2); // one per wallet - no multiplied join
    const total = body.rows.reduce((sum, r) => sum + Number(r.valueUsd), 0);
    expect(total).toBe(6000); // 1 ETH + 2 ETH at $2000 - NOT $12,000
  });

  it('R1: Aave supplied/debt with distinct derived unit prices never multiplies', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ aave: { supplied: '2', debt: '1', suppliedUsd: '4000', debtUsd: '2000.01' } }));
    const body = (await (await call('positions')).json()) as {
      rows: { supplied: string; debt: string; net: string }[];
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ supplied: '2', debt: '1', net: '1' });
  });

  it('cross-user isolation: each caller sees ONLY their own recorded holdings', async () => {
    const c2 = await makeUser('u2', 'b@x.co');
    await grantSnapshotConsent(db, 'u1', NOW);
    await grantSnapshotConsent(db, 'u2', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ observedAt: OBS }));
    await tick();
    await recordObservation(db, 'u2', 'solana', {
      ok: true, provider: 'test-provider', simulated: false, observedAt: OBS,
      wallets: [{
        address: 'SolAddrU2', partial: false, warnings: [],
        assets: [{
          assetId: 'solana:mainnet/native', symbol: 'SOL', decimals: 9,
          rawAmount: '0', amount: '10', price: '100', value: '0',
          priceSource: 'chainlink' as const, priceObservedAt: OBS,
        }],
        aave: undefined,
      }],
    });
    const b1 = (await (await call('assets', cookie)).json()) as { rows: { symbol: string }[] };
    const b2 = (await (await call('assets', c2)).json()) as { rows: { symbol: string }[] };
    expect(b1.rows.map((r) => r.symbol)).toEqual(['ETH']);
    expect(b2.rows.map((r) => r.symbol)).toEqual(['SOL']);
  });

  it('A2(i): a row-less ATTRIBUTED partial run newer than the baseline sets newerPartial', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ observedAt: OBS }));
    await tick();
    await recordObservation(db, 'u1', 'ethereum', zeroRun(OBS2, true)); // partial, zero rows
    const body = (await (await call('assets')).json()) as {
      status: string; latestCompleteObservedAt: string; newerPartial: boolean; newerUnattributed: boolean;
    };
    expect(body.status).toBe('ok'); // complete baseline still serves
    expect(body.latestCompleteObservedAt).toBe(OBS);
    expect(body.newerPartial).toBe(true); // attributed partial - NOT unattributed
    expect(body.newerUnattributed).toBe(false);
  });

  it('A2(ii): error rows never advance baselines and never set either flag', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ observedAt: OBS }));
    await tick();
    await recordSyncError(db, 'u1', 'ethereum', 'unavailable');
    const body = (await (await call('assets')).json()) as {
      status: string; latestCompleteObservedAt: string; newerPartial: boolean; newerUnattributed: boolean;
    };
    expect(body.status).toBe('ok');
    expect(body.latestCompleteObservedAt).toBe(OBS);
    expect(body.newerPartial).toBe(false);
    expect(body.newerUnattributed).toBe(false);
  });

  it('legacy NULL-network runs attribute via rows; a newer legacy ROW-LESS run sets newerUnattributed only', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ observedAt: OBS }));
    // simulate a pre-0005 run: attribution columns absent
    raw.prepare('UPDATE sync_runs SET network = NULL, observed_at = NULL').run();
    const okBody = (await (await call('assets')).json()) as {
      status: string; latestCompleteObservedAt: string; newerUnattributed: boolean;
    };
    expect(okBody.status).toBe('ok');
    expect(okBody.latestCompleteObservedAt).toBe(OBS); // label from the run's rows
    expect(okBody.newerUnattributed).toBe(false);
    // a newer legacy run that recorded NOTHING: coverage unknown, never a baseline
    await tick();
    await db
      .prepare("INSERT INTO sync_runs (id, user_id, requested_at, started_at, completed_at, provider, status, error, completeness, network, observed_at) VALUES ('legacy-empty', 'u1', ?, ?, ?, 'test-provider', 'live', NULL, 'complete', NULL, NULL)")
      .bind(new Date().toISOString(), NOW, NOW)
      .run();
    const body = (await (await call('assets')).json()) as {
      status: string; latestCompleteObservedAt: string; newerPartial: boolean; newerUnattributed: boolean;
    };
    expect(body.status).toBe('ok');
    expect(body.latestCompleteObservedAt).toBe(OBS); // baseline unchanged
    expect(body.newerPartial).toBe(false);
    expect(body.newerUnattributed).toBe(true);
  });

  it('A3: withdrawal deletes runs too - no history, network or time survives', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result({ observedAt: OBS }));
    await tick();
    await recordSyncError(db, 'u1', 'solana', 'timeout');
    const d = await withdrawSnapshotConsent(db, 'u1');
    expect(d.runs).toBe(2);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM sync_runs').get() as { n: number }).toEqual({ n: 0 });
    for (const v of VIEWS) {
      const body = (await (await call(v)).json()) as {
        status: string; reason: string; newerPartial: boolean; newerUnattributed: boolean; networks?: unknown;
      };
      expect(body).toMatchObject({
        status: 'empty',
        reason: 'no_recorded_observations', // indistinguishable from never-observed
        newerPartial: false,
        newerUnattributed: false,
      });
      expect(body.networks).toBeUndefined(); // no network labels survive
    }
  });
});
