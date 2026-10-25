import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { recordObservation, deleteSnapshots, hasSnapshotConsent, SNAPSHOT_CONSENT_KIND } from '../server/portfolio/snapshots';
import type { ProviderResult } from '../server/portfolio/provider';

let db: ReturnType<typeof createSqliteD1>['db'];
let raw: ReturnType<typeof createSqliteD1>['raw'];
beforeEach(async () => {
  ({ db, raw } = createSqliteD1());
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(now, now).run();
  await db.prepare("INSERT INTO portfolios (id, user_id, display_prefs, created_at) VALUES ('pf1','u1',NULL,?)").bind(now).run();
});

const consent = async () =>
  db.prepare("INSERT INTO privacy_consents (user_id, kind, version, consented_at) VALUES ('u1', ?, 'v1', ?)")
    .bind(SNAPSHOT_CONSENT_KIND, new Date().toISOString()).run();

const OBS = '2026-10-25T12:00:00.000Z';
const result = (partial = false): Extract<ProviderResult, { ok: true }> => ({
  ok: true,
  provider: 'test-provider',
  simulated: false,
  observedAt: OBS,
  wallets: [
    {
      address: '0xABC',
      partial,
      warnings: [],
      assets: [
        {
          assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18,
          rawAmount: '1500000000000000000', amount: '1.5',
          price: '2000', value: '3000', priceSource: 'chainlink', priceObservedAt: OBS,
        },
      ],
      aave: {
        status: 'ok',
        positions: [
          {
            underlyingAsset: '0xWETH', symbol: 'WETH', decimals: 18,
            supplied: '2', variableDebt: '0',
            suppliedValueUsd: '4000', variableDebtValueUsd: '0',
            priceSource: 'chainlink', priceObservedAt: OBS, observedAt: OBS,
            usageAsCollateralEnabled: true, reserveNote: null,
          },
        ],
      },
    },
  ],
});
const net = () => 'ethereum' as const;

describe('snapshot recording', () => {
  it('records NOTHING without consent', async () => {
    const r = await recordObservation(db, 'u1', result(), net);
    expect(r).toEqual({ recorded: false, reason: 'no_consent' });
    const n = await db.prepare('SELECT COUNT(*) AS n FROM balance_snapshots').bind().first<{ n: number }>();
    expect(n!.n).toBe(0);
    expect(await hasSnapshotConsent(db, 'u1')).toBe(false);
  });

  it('records balance + position + price rows tied to a sync_run; aave debt side zero omitted', async () => {
    await consent();
    const r = await recordObservation(db, 'u1', result(), net);
    expect(r.recorded).toBe(true);
    if (r.recorded) {
      expect(r.balances).toBe(1);
      expect(r.positions).toBe(1); // supplied only; zero debt side omitted
      expect(r.prices).toBe(2); // ETH + WETH quotes
    }
    const run = await db.prepare("SELECT status, provider FROM sync_runs WHERE user_id='u1'").bind().first<{ status: string }>();
    expect(run!.status).toBe('live');
    const pos = await db.prepare("SELECT protocol, position FROM position_snapshots").bind().first<{ protocol: string; position: string }>();
    expect(pos!.protocol).toBe('aave-v3');
    expect(JSON.parse(pos!.position).kind).toBe('protocol_supplied');
  });

  it('is idempotent: a redelivered identical observation is skipped, never duplicated', async () => {
    await consent();
    await recordObservation(db, 'u1', result(), net);
    const r2 = await recordObservation(db, 'u1', result(), net);
    expect(r2.recorded).toBe(true);
    if (r2.recorded) {
      expect(r2.skippedDuplicates).toBe(2); // balance + position
    }
    const n = await db.prepare('SELECT COUNT(*) AS n FROM balance_snapshots').bind().first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('a partial provider result records with partial status and never erases prior history', async () => {
    await consent();
    await recordObservation(db, 'u1', result(), net);
    const r2 = await recordObservation(db, 'u1', result(true), net); // same rows, partial flag
    expect(r2.recorded).toBe(true);
    const runs = await db.prepare("SELECT status FROM sync_runs ORDER BY rowid").bind().all<{ status: string }>();
    expect(runs.results.map((x) => x.status)).toEqual(['live', 'partial']);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM balance_snapshots').bind().first<{ n: number }>();
    expect(n!.n).toBe(1); // history intact
  });

  it('consent withdrawal deletes all snapshot history for the user', async () => {
    await consent();
    await recordObservation(db, 'u1', result(), net);
    raw.exec("UPDATE privacy_consents SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    expect(await hasSnapshotConsent(db, 'u1')).toBe(false);
    const d = await deleteSnapshots(db, 'u1');
    expect(d).toEqual({ balances: 1, positions: 1, prices: 2 });
    for (const t of ['balance_snapshots', 'position_snapshots', 'price_observations']) {
      const n = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).bind().first<{ n: number }>();
      expect(n!.n).toBe(0);
    }
    // recording after withdrawal is refused
    const r = await recordObservation(db, 'u1', result(), net);
    expect(r).toEqual({ recorded: false, reason: 'no_consent' });
  });
});
