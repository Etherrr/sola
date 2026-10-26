import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { tick } from './helpers/tick';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { onRequest as overviewRoute } from '../functions/api/v1/portfolio/overview';
import { onRequest as summaryRoute } from '../functions/api/v1/portfolio/summary';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import { grantSnapshotConsent, recordObservation } from '../server/portfolio/snapshots';
import type { ProviderResult } from '../server/portfolio/provider';

// PERMANENT route-contract pin: /api/v1/portfolio/overview is the slice-1
// What-changed route (overview-handler); /api/v1/portfolio/summary is the
// slice-3 page wire (views-handler 'overview'). A route-file overwrite once
// slipped through handler-level tests - this test fails the suite instead.
describe('route contract separation', () => {
  it('pins each route file to its own handler', () => {
    const oldRoute = readFileSync('functions/api/v1/portfolio/overview.ts', 'utf8');
    const newRoute = readFileSync('functions/api/v1/portfolio/summary.ts', 'utf8');
    expect(oldRoute).toMatch(/import \{ handleOverview/);
    expect(oldRoute).toMatch(/overview-handler';/);
    expect(oldRoute).not.toMatch(/views-handler|handlePortfolioView/);
    expect(newRoute).toMatch(/import \{ handlePortfolioView/);
    expect(newRoute).toMatch(/views-handler';/);
    expect(newRoute).not.toMatch(/overview-handler';|\bhandleOverview\(/);
  });
});

describe('route response shapes stay distinct', () => {
  let db: ReturnType<typeof createSqliteD1>['db'];
  let cookie: string;
  const NOW = new Date().toISOString();

  beforeEach(async () => {
    ({ db } = createSqliteD1());
    await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(NOW, NOW).run();
    await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES ('i1','u1','email','invited@x.co',?)").bind(NOW).run();
    await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES ('e1','invited@x.co','owner',?)").bind(NOW).run();
    await db.prepare("INSERT INTO portfolios (id, user_id, display_prefs, created_at) VALUES ('pf1','u1',NULL,?)").bind(NOW).run();
    const s = await createSession(db, 'u1');
    cookie = `${SESSION_COOKIE}=${s.id}`;
  });

  const env = () => ({ PORTFOLIO_ACCOUNTS: '1', PORTFOLIO_ACCOUNTS_DB: db });
  const req = (path: string) => new Request(`https://app.test${path}`, { headers: { cookie } });

  it('empty state: What-changed has no totals/allocation; summary has none either but carries its own reason', async () => {
    const oldBody = (await (await overviewRoute({ request: req('/api/v1/portfolio/overview'), env: env() })).json()) as Record<string, unknown>;
    expect(oldBody.status).toBe('empty');
    expect(oldBody.reason).toBe('no_recorded_observations');
    expect(oldBody.totals).toBeUndefined();
    expect(oldBody.allocation).toBeUndefined();
    expect(oldBody.history).toBeUndefined();
    const newBody = (await (await summaryRoute({ request: req('/api/v1/portfolio/summary'), env: env() })).json()) as Record<string, unknown>;
    expect(newBody.status).toBe('empty');
    expect(newBody.reason).toBe('no_recorded_observations');
    expect(newBody.latest).toBeUndefined();
    expect(newBody.prior).toBeUndefined();
  });

  it('recorded state: What-changed serves latest/prior; summary serves totals/allocation/history - never crossed', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    const result: Extract<ProviderResult, { ok: true }> = {
      ok: true, provider: 'test-provider', simulated: false, observedAt: '2026-10-25T12:00:00.000Z',
      wallets: [{
        address: '0xABC', partial: false, warnings: [],
        assets: [{ assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18, rawAmount: '0', amount: '1', price: '3000', value: '0', priceSource: 'chainlink', priceObservedAt: '2026-10-25T12:00:00.000Z' }],
      }],
    };
    await tick();
    await recordObservation(db, 'u1', 'ethereum', result);
    const oldBody = (await (await overviewRoute({ request: req('/api/v1/portfolio/overview'), env: env() })).json()) as Record<string, unknown>;
    expect(oldBody.status).toBe('ok');
    expect(oldBody.scope).toBe('spot_balances_only');
    expect(oldBody.latest).toBeDefined();
    expect(oldBody.prior).toBeDefined();
    expect(oldBody.totals).toBeUndefined();
    expect(oldBody.allocation).toBeUndefined();
    const newBody = (await (await summaryRoute({ request: req('/api/v1/portfolio/summary'), env: env() })).json()) as Record<string, unknown>;
    expect(newBody.status).toBe('ok');
    expect(newBody.view).toBe('overview');
    expect(newBody.scope).toBe('recorded_observations_only');
    expect(newBody.totals).toBeDefined();
    expect(newBody.allocation).toBeDefined();
    expect(newBody.history).toBeDefined();
    expect(newBody.latest).toBeUndefined();
    expect(newBody.prior).toBeUndefined();
  });
});
