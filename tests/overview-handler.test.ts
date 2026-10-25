import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { handleOverview } from '../server/portfolio/overview-handler';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
import { grantSnapshotConsent, recordObservation } from '../server/portfolio/snapshots';
import type { ProviderResult } from '../server/portfolio/provider';

const net = (a: string): 'ethereum' | 'solana' => (a.startsWith('0x') ? 'ethereum' : 'solana');

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

const get = (c: string | null) =>
  new Request('https://app.test/api/v1/portfolio/overview', {
    method: 'GET',
    ...(c ? { headers: { cookie: c } } : {}),
  });
const envOn = () => ({ PORTFOLIO_ACCOUNTS: '1', PORTFOLIO_ACCOUNTS_DB: db });

const obs = (amount: string, observedAt: string): Extract<ProviderResult, { ok: true }> => ({
  ok: true, provider: 'test-provider', simulated: false, observedAt,
  wallets: [{
    address: '0xABC', partial: false, warnings: [],
    assets: [{
      assetId: 'eip155:1/native', symbol: 'ETH', decimals: 18,
      rawAmount: '0', amount, price: '2000', value: '0',
      priceSource: 'chainlink', priceObservedAt: observedAt,
    }],
    aave: undefined,
  }],
});

describe('overview read route', () => {
  it('405 on non-GET; 503 when flag off or binding missing', async () => {
    expect((await handleOverview(new Request('https://app.test/x', { method: 'POST' }), envOn())).status).toBe(405);
    expect((await handleOverview(get(cookie), { PORTFOLIO_ACCOUNTS: '0', PORTFOLIO_ACCOUNTS_DB: db })).status).toBe(503);
    expect((await handleOverview(get(cookie), { PORTFOLIO_ACCOUNTS: '1' })).status).toBe(503);
  });

  it('401 without a session; 403 without entitlement', async () => {
    expect((await handleOverview(get(null), envOn())).status).toBe(401);
    await db.prepare('DELETE FROM entitlements').bind().run();
    expect((await handleOverview(get(cookie), envOn())).status).toBe(403);
  });

  it('honest empty state: no recorded observations -> status empty, never a zero claim', async () => {
    const r = await handleOverview(get(cookie), envOn());
    expect(r.status).toBe(200);
    const body = (await r.json()) as { status: string; reason: string };
    expect(body.status).toBe('empty');
    expect(body.reason).toBe('no_recorded_observations');
  });

  it('returns latest+prior COMPLETE-run slices, labeled spot-only, after recorded observations', async () => {
    await grantSnapshotConsent(db, 'u1', NOW);
    await recordObservation(db, 'u1', obs('1.0', '2026-10-25T10:00:00Z'), net);
    await recordObservation(db, 'u1', obs('1.5', '2026-10-25T11:00:00Z'), net);
    const r = await handleOverview(get(cookie), envOn());
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      status: string; scope: string; latestCompleteObservedAt: string;
      latest: unknown[]; prior: unknown[] | null;
    };
    expect(body.status).toBe('ok');
    expect(body.scope).toBe('spot_balances_only');
    expect(body.latestCompleteObservedAt).toBe('2026-10-25T11:00:00Z');
    expect(body.latest.length).toBeGreaterThan(0);
    expect(body.prior).not.toBeNull();
  });

  it('reads only the caller OWN history (other user data invisible)', async () => {
    await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u2','active',?,?)").bind(NOW, NOW).run();
    await db.prepare("INSERT INTO portfolios (id, user_id, display_prefs, created_at) VALUES ('pf2','u2',NULL,?)").bind(NOW).run();
    await grantSnapshotConsent(db, 'u2', NOW);
    await recordObservation(db, 'u2', obs('9.9', '2026-10-25T12:00:00Z'), net);
    const r = await handleOverview(get(cookie), envOn());
    const body = (await r.json()) as { status: string };
    expect(body.status).toBe('empty');
  });
});
