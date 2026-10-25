import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { handleSync, type SyncDeps, type SyncEnv } from '../server/portfolio/sync';
import { grantSnapshotConsent } from '../server/portfolio/snapshots';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE, type NativeAuthEnv } from '../server/auth/email';
import type { PortfolioProvider, ProviderResult } from '../server/portfolio/provider';

const EVM = '0x1111111111111111111111111111111111111111';
const OBS = '2026-10-25T12:00:00.000Z';

let db: ReturnType<typeof createSqliteD1>['db'];
let raw: ReturnType<typeof createSqliteD1>['raw'];
let env: SyncEnv;
let cookie: string;

const post = (c?: string, origin = 'https://preview.test') =>
  new Request('https://preview.test/api/v1/portfolio/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...(c ? { cookie: c } : {}) },
    body: '{}',
  });

const provider = (result: ProviderResult, calls: { n: number }): PortfolioProvider => ({
  name: 'fake',
  simulated: false,
  fetchWallets: async () => { calls.n += 1; return result; },
});

const liveOk = (address: string): ProviderResult => ({
  ok: true,
  provider: 'fake-live',
  simulated: false,
  observedAt: OBS,
  wallets: [{
    address,
    partial: false,
    warnings: [],
    assets: [{
      assetId: 'eth', symbol: 'ETH', decimals: 18, rawAmount: '1000000000000000000',
      amount: '1', price: '3000', priceSource: 'test', priceObservedAt: OBS, value: '3000',
    }],
  }],
});

const deps = (eth: PortfolioProvider, sol?: PortfolioProvider): SyncDeps => ({
  ethereum: eth,
  solana: sol ?? eth,
  timeoutMs: 5000,
});

const entitle = async (userId: string, email: string) => {
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES (?, ?, 'email', ?, ?)")
    .bind(crypto.randomUUID(), userId, email, now).run();
  await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES (?, ?, 'test', ?)")
    .bind(crypto.randomUUID(), email, now).run();
};

const addAddress = async (network: string, address: string) => {
  const now = new Date().toISOString();
  await db.prepare("INSERT OR IGNORE INTO portfolios (id, user_id, created_at) VALUES ('pf1','u1',?)").bind(now).run();
  await db.prepare("INSERT INTO portfolio_addresses (portfolio_id, network, address, label, verification, created_at) VALUES ('pf1', ?, ?, 'test wallet', 'watched', ?)")
    .bind(network, address, now).run();
};

beforeEach(async () => {
  ({ db, raw } = createSqliteD1());
  env = { NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db, PORTFOLIO_LIVE_DATA: '1' };
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(now, now).run();
  await entitle('u1', 'u1@x.test');
  const s = await createSession(db, 'u1');
  cookie = `${SESSION_COOKIE}=${s.id}`;
});

describe('observation sync', () => {
  it('NO CONSENT: records nothing and never calls the provider', async () => {
    await addAddress('ethereum', EVM);
    const calls = { n: 0 };
    const r = await handleSync(post(cookie), env, deps(provider(liveOk(EVM), calls)));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { recorded: boolean; reason: string };
    expect(body).toMatchObject({ recorded: false, reason: 'no_consent' });
    expect(calls.n).toBe(0);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM sync_runs').get() as { n: number }).toEqual({ n: 0 });
  });

  it('consent + no saved addresses: honest no_addresses, no provider call', async () => {
    await grantSnapshotConsent(db, 'u1');
    const calls = { n: 0 };
    const r = await handleSync(post(cookie), env, deps(provider(liveOk(EVM), calls)));
    expect(((await r.json()) as { reason: string }).reason).toBe('no_addresses');
    expect(calls.n).toBe(0);
  });

  it('consent + live flag off: 503 live_data_off, records nothing', async () => {
    await grantSnapshotConsent(db, 'u1');
    await addAddress('ethereum', EVM);
    const off: SyncEnv = { ...(env as NativeAuthEnv), PORTFOLIO_LIVE_DATA: '0' };
    const calls = { n: 0 };
    const r = await handleSync(post(cookie), off, deps(provider(liveOk(EVM), calls)));
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe('live_data_off');
    expect(calls.n).toBe(0);
  });

  it('records one run + balance snapshot for a consented live read; identical re-sync is deduplicated', async () => {
    await grantSnapshotConsent(db, 'u1');
    await addAddress('ethereum', EVM);
    const calls = { n: 0 };
    const d = deps(provider(liveOk(EVM), calls));
    const r1 = await handleSync(post(cookie), env, d);
    const b1 = (await r1.json()) as { recorded: boolean; runs: Array<{ recorded: boolean; balances: number }> };
    expect(b1.recorded).toBe(true);
    expect(b1.runs[0]).toMatchObject({ recorded: true, balances: 1 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM balance_snapshots').get() as { n: number }).toEqual({ n: 1 });
    const r2 = await handleSync(post(cookie), env, d);
    const b2 = (await r2.json()) as { runs: Array<{ balances: number; skippedDuplicates: number }> };
    expect(b2.runs[0]).toMatchObject({ balances: 0, skippedDuplicates: 1 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM balance_snapshots').get() as { n: number }).toEqual({ n: 1 });
  });

  it('SIMULATED results are refused even with consent and live flag', async () => {
    await grantSnapshotConsent(db, 'u1');
    await addAddress('ethereum', EVM);
    const sim: ProviderResult = { ...(liveOk(EVM) as Extract<ProviderResult, { ok: true }>), simulated: true };
    const r = await handleSync(post(cookie), env, deps(provider(sim, { n: 0 })));
    const body = (await r.json()) as { recorded: boolean; runs: Array<{ recorded: boolean; reason: string }> };
    expect(body.recorded).toBe(false);
    expect(body.runs[0]).toMatchObject({ recorded: false, reason: 'simulated_refused' });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM balance_snapshots').get() as { n: number }).toEqual({ n: 0 });
  });

  it('a failed provider read is an honest per-network state, not recorded', async () => {
    await grantSnapshotConsent(db, 'u1');
    await addAddress('ethereum', EVM);
    const bad: ProviderResult = { ok: false, provider: 'fake', kind: 'unavailable', diag: { step: 'rpc_error' } } as ProviderResult;
    const r = await handleSync(post(cookie), env, deps(provider(bad, { n: 0 })));
    const body = (await r.json()) as { recorded: boolean; runs: Array<{ recorded: boolean; reason: string }> };
    expect(body.recorded).toBe(false);
    expect(body.runs[0]).toMatchObject({ recorded: false, reason: 'unavailable' });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM sync_runs').get() as { n: number }).toEqual({ n: 0 });
  });

  it('gates: 401 without session, 403 cross-origin, 405 on GET', async () => {
    expect((await handleSync(post(), env, deps(provider(liveOk(EVM), { n: 0 })))).status).toBe(401);
    expect((await handleSync(post(cookie, 'https://evil.test'), env, deps(provider(liveOk(EVM), { n: 0 })))).status).toBe(403);
    const g = new Request('https://preview.test/api/v1/portfolio/sync', { method: 'GET' });
    expect((await handleSync(g, env, deps(provider(liveOk(EVM), { n: 0 })))).status).toBe(405);
  });
});
