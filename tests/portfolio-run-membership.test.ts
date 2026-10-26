import { describe, it, expect, beforeEach } from 'vitest';
import { tick } from './helpers/tick';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { handlePortfolioView } from '../server/portfolio/views-handler';
import { loadBalanceHistory } from '../server/portfolio/history';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import { grantSnapshotConsent, recordObservation } from '../server/portfolio/snapshots';
import type { ProviderResult } from '../server/portfolio/provider';

/**
 * STRICT RUN MEMBERSHIP regressions (run-membership design verdict,
 * 2026-10-26, option 3): reads load exactly the serving run's OWN rows -
 * no instant unions, no cross-run fallback. Write ids are run-scoped, so
 * every run's baseline is self-contained and same-instant removals never
 * resurrect. Legacy (pre-0005) runs are read strictly too and may
 * UNDER-SERVE; they are never presented as exact (recordedRunMembership).
 */

let db: ReturnType<typeof createSqliteD1>['db'];
let raw: ReturnType<typeof createSqliteD1>['raw'];
let cookie: string;
const NOW = new Date().toISOString();
const T = '2026-10-25T12:00:00.000Z'; // ONE shared provider instant for Case B/C

beforeEach(async () => {
  ({ db, raw } = createSqliteD1());
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(NOW, NOW).run();
  await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('i1','u1','email','a@x.co',?)").bind(NOW).run();
  await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES ('e1','a@x.co','owner',?)").bind(NOW).run();
  await db.prepare("INSERT INTO portfolios (id, user_id, display_prefs, created_at) VALUES ('pf1','u1',NULL,?)").bind(NOW).run();
  const s = await createSession(db, 'u1');
  cookie = `${SESSION_COOKIE}=${s.id}`;
});

const asset = (assetId: string, symbol: string, amount: string, price: string | null = null) => ({
  assetId, symbol, decimals: 18, rawAmount: '0', amount,
  price, value: price ? '0' : '0', priceSource: price ? 'chainlink' : null, priceObservedAt: price ? T : null,
});
const run = (assets: ReturnType<typeof asset>[], observedAt = T): Extract<ProviderResult, { ok: true }> => ({
  ok: true, provider: 'test-provider', simulated: false, observedAt,
  wallets: [{ address: '0xAAA', partial: false, warnings: [], assets, aave: undefined }],
});
const assetsNow = async () => {
  const r = await handlePortfolioView(
    new Request('https://app.test/api/v1/portfolio/assets', { headers: { cookie } }),
    { PORTFOLIO_ACCOUNTS: '1', PORTFOLIO_ACCOUNTS_DB: db } as never, 'assets');
  return (await r.json()) as {
    status: string; reason?: string; recordedRunMembership?: string;
    rows?: { symbol: string; amount: string; priceUsd: string | null }[];
  };
};

describe('strict run membership at one shared instant (verdict Case B + Case C)', () => {
  it('Case B: same-instant REMOVAL - the newer run serves exactly its own rows (no resurrected USDC)', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', run([
      asset('eip155:1/native', 'ETH', '1.5'),
      asset('eip155:1/erc20:0xUSDC', 'USDC', '9'),
    ]));
    await tick();
    const r2 = await recordObservation(db, 'u1', 'ethereum', run([asset('eip155:1/native', 'ETH', '1.5')]));
    expect(r2.recorded && r2.balances).toBe(1);
    const body = await assetsNow();
    expect(body.status).toBe('ok');
    // EXACT: only what the serving run itself recorded. The removed USDC is
    // NOT served from the earlier run at the same instant.
    expect(body.rows?.map((r) => r.symbol)).toEqual(['ETH']);
  });

  it('Case B What-changed semantics: the SAME-INSTANT prior is served, so the removal is the shown delta (reviewer reconciliation 2026-10-26)', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', run([
      asset('eip155:1/native', 'ETH', '1.5'),
      asset('eip155:1/erc20:0xUSDC', 'USDC', '9'),
    ]));
    await tick();
    await recordObservation(db, 'u1', 'ethereum', run([asset('eip155:1/native', 'ETH', '1.5')]));
    const h = await loadBalanceHistory(db, 'u1');
    // Prior = the IMMEDIATELY PREVIOUS complete run, whatever its instant:
    // skipping R1 for sharing the baseline's instant would hide the USDC
    // removal behind "first recorded observation" or a stale older delta.
    expect(h.latest.map((r) => r.assetId)).toEqual(['eip155:1/native']);
    expect(h.prior).not.toBeNull();
    expect(h.prior?.map((r) => `${r.assetId}:${r.amount}`).sort()).toEqual([
      'eip155:1/erc20:0xUSDC:9',
      'eip155:1/native:1.5',
    ]);
    const slice = h.networks.find((n) => n.network === 'ethereum');
    expect(slice?.prior?.map((r) => r.assetId).sort()).toEqual([
      'eip155:1/erc20:0xUSDC',
      'eip155:1/native',
    ]);
  });

  it('Case C: identical re-observation at the same instant - the new run is a self-contained baseline', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', run([asset('eip155:1/native', 'ETH', '1.5')]));
    await tick();
    const r2 = await recordObservation(db, 'u1', 'ethereum', run([asset('eip155:1/native', 'ETH', '1.5')]));
    // Run-scoped ids: the second run writes FRESH rows (within-run dedup only).
    expect(r2.recorded && r2.balances).toBe(1);
    expect(r2.recorded && r2.skippedDuplicates).toBe(0);
    const body = await assetsNow();
    expect(body.status).toBe('ok');
    expect(body.rows?.map((r) => r.amount)).toEqual(['1.5']);
    // Exactly one row served - the baseline run's own, not a union.
    expect(body.rows).toHaveLength(1);
  });

  it('Case B counterpart: same-instant ADDITION is served from the newer run only', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', run([asset('eip155:1/native', 'ETH', '1.5')]));
    await tick();
    await recordObservation(db, 'u1', 'ethereum', run([
      asset('eip155:1/native', 'ETH', '1.5'),
      asset('eip155:1/erc20:0xUSDC', 'USDC', '9'),
    ]));
    const body = await assetsNow();
    // Read-path symbols derive from the assetId (eip155:1/erc20:0xUSDC -> 0xUSDC).
    expect(body.rows?.map((r) => r.symbol).sort()).toEqual(['0xUSDC', 'ETH']);
  });
});

describe('strict run membership across instants', () => {
  it('identical re-observation at a NEW instant: fresh rows, self-contained baseline', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', run([asset('eip155:1/native', 'ETH', '1.5')]));
    await tick();
    const r2 = await recordObservation(db, 'u1', 'ethereum', run([asset('eip155:1/native', 'ETH', '1.5')], '2026-10-25T13:00:00.000Z'));
    expect(r2.recorded && r2.balances).toBe(1);
    expect(r2.recorded && r2.skippedDuplicates).toBe(0);
    const n = raw.prepare('SELECT COUNT(*) AS n FROM balance_snapshots').get() as { n: number };
    expect(n.n).toBe(2);
    const body = await assetsNow();
    expect(body.status).toBe('ok');
    expect(body.rows?.map((r) => r.amount)).toEqual(['1.5']);
  });

  it('identical QUOTE across runs: the latest run stores its own quote and stays PRICED', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', run([asset('eip155:1/native', 'ETH', '1.5', '2000')]));
    await tick();
    const r2 = await recordObservation(db, 'u1', 'ethereum', run([asset('eip155:1/native', 'ETH', '1.5', '2000')], '2026-10-25T13:00:00.000Z'));
    expect(r2.recorded && r2.prices).toBe(1);
    const n = raw.prepare('SELECT COUNT(*) AS n FROM price_observations').get() as { n: number };
    expect(n.n).toBe(2); // both runs priced; no cross-run quote dedup
    const body = await assetsNow();
    expect(body.rows?.[0]?.priceUsd).toBe('2000'); // never left falsely UNPRICED
  });

  it('removed SOLE address: a newer complete run with zero wallets is an honest empty, old rows never resurface', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', run([asset('eip155:1/native', 'ETH', '1.5')]));
    await tick();
    const r2 = await recordObservation(db, 'u1', 'ethereum', {
      ok: true, provider: 'test-provider', simulated: false, observedAt: '2026-10-25T13:00:00.000Z', wallets: [],
    });
    expect(r2.recorded && r2.balances).toBe(0);
    const body = await assetsNow();
    expect(body.status).not.toBe('ok');
    expect(body.rows ?? []).toEqual([]);
  });
});

describe('recordedRunMembership marker', () => {
  it('fresh-era serving runs: exact, in history and in the views response', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await tick();
    await recordObservation(db, 'u1', 'ethereum', run([asset('eip155:1/native', 'ETH', '1.5')]));
    const h = await loadBalanceHistory(db, 'u1');
    expect(h.recordedRunMembership).toBe('exact');
    const body = await assetsNow();
    expect(body.recordedRunMembership).toBe('exact');
  });

  it('a legacy serving baseline (latest OR prior) marks best_effort_legacy', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    // Legacy era fixture: a pre-0005 run (network/observed_at NULL) whose
    // rows were written under cross-run content-hash dedup.
    await db.prepare(
      "INSERT INTO sync_runs (id, user_id, requested_at, provider, status, completeness) VALUES ('run-legacy','u1','2026-10-20T10:00:00.000Z','test-provider','live','complete')",
    ).bind().run();
    await db.prepare(
      "INSERT INTO balance_snapshots (id, sync_run_id, portfolio_id, network, address, asset_id, amount, observed_at) VALUES ('b-legacy','run-legacy','pf1','ethereum','0xAAA','eip155:1/native','1.5','2026-10-20T10:00:00.000Z')",
    ).bind().run();
    // Legacy baseline only -> legacy marker.
    const h1 = await loadBalanceHistory(db, 'u1');
    expect(h1.recordedRunMembership).toBe('best_effort_legacy');
    expect(h1.latest.map((r) => r.amount)).toEqual(['1.5']);
    // Legacy LATEST: the assets/positions views serve that baseline, so the
    // marker reaches their responses too.
    const legacyBody = await assetsNow();
    expect(legacyBody.recordedRunMembership).toBe('best_effort_legacy');
    // Fresh newer run on top: the legacy PRIOR still forces the marker.
    await tick();
    await recordObservation(db, 'u1', 'ethereum', run([asset('eip155:1/native', 'ETH', '2')], '2026-10-25T12:00:00.000Z'));
    const h2 = await loadBalanceHistory(db, 'u1');
    expect(h2.recordedRunMembership).toBe('best_effort_legacy');
    expect(h2.latest.map((r) => r.amount)).toEqual(['2']);
    expect(h2.prior?.map((r) => r.amount)).toEqual(['1.5']);
    // The assets/positions views serve LATEST baselines only; with a fresh
    // latest they are exact even though the history prior is legacy (the
    // overview/what-changed response above carries the legacy marker).
    const body = await assetsNow();
    expect(body.recordedRunMembership).toBe('exact');
  });

  it('legacy under-serve: strict legacy read may serve FEWER rows than observed at the instant - never phantom holdings', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    // Pre-fix era at one shared instant: legacy run L1 recorded ETH+USDC;
    // legacy run L2 (newer, same instant) re-observed the SAME portfolio -
    // under cross-run content-hash dedup L2's identical ETH row was SKIPPED
    // and only the changed USDC row belongs to L2. Per-run membership is
    // irrecoverable: reading L2 strictly UNDER-SERVES ETH. This direction is
    // deliberate (never phantom holdings); the marker tells consumers the
    // data is best-effort. The ETH row is NOT asserted as served - exact
    // membership cannot be reconstructed for legacy runs.
    const legacy = (id: string, at: string) =>
      db.prepare(
        `INSERT INTO sync_runs (id, user_id, requested_at, provider, status, completeness) VALUES (?, 'u1', ?, 'test-provider', 'live', 'complete')`,
      ).bind(id, at).run();
    await legacy('run-l1', '2026-10-20T10:00:00.000Z');
    await legacy('run-l2', '2026-10-20T10:00:01.000Z');
    const ins = (id: string, runId: string, assetId: string, amount: string) =>
      db.prepare(
        `INSERT INTO balance_snapshots (id, sync_run_id, portfolio_id, network, address, asset_id, amount, observed_at) VALUES (?, ?, 'pf1', 'ethereum', '0xAAA', ?, ?, '2026-10-20T10:00:00.000Z')`,
      ).bind(id, runId, assetId, amount).run();
    await ins('b-l1-eth', 'run-l1', 'eip155:1/native', '1.5');
    await ins('b-l1-usdc', 'run-l1', 'eip155:1/erc20:0xUSDC', '9');
    await ins('b-l2-usdc', 'run-l2', 'eip155:1/erc20:0xUSDC', '10'); // L2's ETH row was deduped away in the legacy era
    const h = await loadBalanceHistory(db, 'u1');
    expect(h.recordedRunMembership).toBe('best_effort_legacy');
    // UNDER-SERVE documented: L2 strictly owns only its USDC row. ETH is
    // absent (never served from another run) and nothing phantom appears.
    expect(h.latest.map((r) => r.assetId)).toEqual(['eip155:1/erc20:0xUSDC']);
    expect(h.latest.map((r) => r.amount)).toEqual(['10']);
  });
});
