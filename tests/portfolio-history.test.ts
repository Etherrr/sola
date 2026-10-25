import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { loadBalanceHistory } from '../server/portfolio/history';
import { grantSnapshotConsent, recordObservation } from '../server/portfolio/snapshots';
import type { ProviderResult } from '../server/portfolio/provider';

let db: ReturnType<typeof createSqliteD1>['db'];
beforeEach(async () => {
  ({ db } = createSqliteD1());
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(now, now).run();
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u2','active',?,?)").bind(now, now).run();
  await db.prepare("INSERT INTO portfolios (id, user_id, display_prefs, created_at) VALUES ('pf1','u1',NULL,?)").bind(now).run();
});

const obs = (amount: string, observedAt: string): Extract<ProviderResult, { ok: true }> => ({
  ok: true,
  provider: 'test-provider',
  simulated: false,
  observedAt,
  wallets: [{
    address: '0xABC',
    partial: false,
    warnings: [],
    assets: [{
      assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18,
      rawAmount: '0', amount,
      price: '2000', value: '0', priceSource: 'chainlink', priceObservedAt: observedAt,
    }],
    aave: undefined,
  }],
});
const net = () => 'ethereum' as const;

describe('loadBalanceHistory', () => {
  it('no history => honest empty state', async () => {
    const h = await loadBalanceHistory(db, 'u1');
    expect(h).toEqual({ latestObservedAt: null, prior: null, latest: [] });
  });

  it('one observation => prior is null (never a fabricated zero baseline)', async () => {
    await grantSnapshotConsent(db, 'u1');
    await recordObservation(db, 'u1', obs('1.5', '2026-10-25T11:00:00Z'), net);
    const h = await loadBalanceHistory(db, 'u1');
    expect(h.latestObservedAt).toBe('2026-10-25T11:00:00Z');
    expect(h.prior).toBeNull();
    expect(h.latest).toHaveLength(1);
  });

  it('two observations => prior carries the earlier amounts', async () => {
    await grantSnapshotConsent(db, 'u1');
    await recordObservation(db, 'u1', obs('1.5', '2026-10-25T11:00:00Z'), net);
    await recordObservation(db, 'u1', obs('2', '2026-10-25T12:00:00Z'), net);
    const h = await loadBalanceHistory(db, 'u1');
    expect(h.prior).toHaveLength(1);
    expect(h.prior![0].amount).toBe('1.5');
    expect(h.latest[0].amount).toBe('2');
  });

  it('never leaks another user\'s rows', async () => {
    await grantSnapshotConsent(db, 'u1');
    await recordObservation(db, 'u1', obs('1.5', '2026-10-25T11:00:00Z'), net);
    const h = await loadBalanceHistory(db, 'u2');
    expect(h).toEqual({ latestObservedAt: null, prior: null, latest: [] });
  });
});

describe('complete-runs-only baselines (reviewer)', () => {
  const obsPartial = (amount: string, observedAt: string): Extract<ProviderResult, { ok: true }> => {
    const r = obs(amount, observedAt);
    r.wallets[0].partial = true; // marks the sync_run completeness='partial'
    return r;
  };

  it('a PARTIAL prior run is never a baseline: missing assets do not read as new/gain', async () => {
    await grantSnapshotConsent(db, 'u1');
    // complete run with ETH, then a PARTIAL run (Solana-only scenario), then a full run
    await recordObservation(db, 'u1', obs('1.5', '2026-10-25T10:00:00Z'), net);
    await recordObservation(db, 'u1', obsPartial('1.5', '2026-10-25T11:00:00Z'), net);
    await recordObservation(db, 'u1', obs('2', '2026-10-25T12:00:00Z'), net);
    const h = await loadBalanceHistory(db, 'u1');
    // latest = 12:00 complete; prior must SKIP the 11:00 partial and use 10:00 complete
    expect(h.latestObservedAt).toBe('2026-10-25T12:00:00Z');
    expect(h.prior).toHaveLength(1);
    expect(h.prior![0].observedAt).toBe('2026-10-25T10:00:00Z');
  });

  it('ONLY partial history exists => unknown, never a zero baseline', async () => {
    await grantSnapshotConsent(db, 'u1');
    await recordObservation(db, 'u1', obsPartial('1.5', '2026-10-25T11:00:00Z'), net);
    const h = await loadBalanceHistory(db, 'u1');
    expect(h.latestObservedAt).toBeNull();
    expect(h.prior).toBeNull();
    expect(h.latest).toEqual([]);
  });
});
