/**
 * Mount-level gate tests for the LOCAL claim route mounts (functions/api/v1/claim/*).
 * Proves the routing layer enforces the deployment flag gate BEFORE any handler or
 * database work: with the gate closed every mount answers 503 disabled while a
 * database object that THROWS ON ANY USE stays untouched; with the gate open the
 * mount invokes the real handler (its 401 unauthenticated answer proves the handler,
 * not the mount, responded). All-local; no network, no provider/auth calls.
 * Adapter-level only: not D1 evidence, not a deployment approval.
 */
import { describe, expect, it } from 'vitest';
import { onRequest as previewMount } from '../functions/api/v1/claim/preview';
import { onRequest as attemptMount } from '../functions/api/v1/claim/attempt';
import { onRequest as reportMount } from '../functions/api/v1/claim/report/[attemptId]';
import { onRequest as rollbackMount } from '../functions/api/v1/claim/rollback/[attemptId]';
import { claimAttemptParam, claimMountGate } from '../server/claim/mount';
import { claimDisabled, claimGateOpen, type ClaimEnv } from '../server/claim/routes';
import { createSqliteD1 } from './helpers/d1-sqlite';

const TEAM = 'team-example.cloudflareaccess.com';

/** A database that fails the test if ANY part of the stack touches it. */
const boomDb = () => {
  const boom = (): never => {
    throw new Error('DB TOUCHED: flag gate did not precede database work');
  };
  return { prepare: boom, batch: boom } as never;
};

const envWith = (over: Record<string, unknown>): ClaimEnv =>
  ({
    NATIVE_AUTH_ENABLED: 'true',
    CLAIM_ENABLED: '1',
    PORTFOLIO_ACCOUNTS_DB: boomDb(),
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: 'aud123',
    ...over,
  }) as ClaimEnv;

const req = (method: string, path: string) =>
  new Request(`https://preview.test${path}`, {
    method,
    headers: { origin: 'https://preview.test' },
  });

const MOUNTS: { name: string; call: (env: ClaimEnv, method: string) => Promise<Response> | Response }[] = [
  { name: 'preview', call: (env, method) => previewMount({ request: req(method, '/api/v1/claim/preview'), env }) },
  { name: 'attempt', call: (env, method) => attemptMount({ request: req(method, '/api/v1/claim/attempt'), env }) },
  {
    name: 'report',
    call: (env, method) =>
      reportMount({ request: req(method, '/api/v1/claim/report/att-1'), env, params: { attemptId: 'att-1' } }),
  },
  {
    name: 'rollback',
    call: (env, method) =>
      rollbackMount({ request: req(method, '/api/v1/claim/rollback/att-1'), env, params: { attemptId: 'att-1' } }),
  },
];

describe('flag gate BEFORE any database work (boom DB must stay untouched)', () => {
  for (const m of MOUNTS) {
    it(`${m.name}: CLAIM_ENABLED absent -> 503 disabled, zero database work`, async () => {
      const res = await m.call(envWith({ CLAIM_ENABLED: undefined }), m.name === 'preview' || m.name === 'report' ? 'GET' : 'POST');
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe('disabled');
    });
  }
  it('gate also closed when CLAIM_ENABLED is "0", native auth off, or the binding is absent', async () => {
    for (const over of [
      { CLAIM_ENABLED: '0' },
      { NATIVE_AUTH_ENABLED: undefined },
      { PORTFOLIO_ACCOUNTS_DB: undefined },
      { CLAIM_ENABLED: 'true' }, // exact '1' only
    ]) {
      const res = await previewMount({ request: req('GET', '/api/v1/claim/preview'), env: envWith(over) });
      expect(res.status).toBe(503);
    }
  });
  it('mount gate and handler gate share one predicate and one wire shape', async () => {
    const env = envWith({ CLAIM_ENABLED: undefined });
    const fromMount = claimMountGate(env, 'r-1');
    const fromHandler = claimDisabled('r-1');
    expect(claimGateOpen(env)).toBe(false);
    expect(fromMount).not.toBeNull();
    expect(fromMount!.status).toBe(fromHandler.status);
    expect(await fromMount!.text()).toBe(await fromHandler.text());
  });
});

describe('gate open: the mount invokes the real handler', () => {
  for (const m of MOUNTS) {
    it(`${m.name}: unauthenticated request reaches the handler (401, not 503/500)`, async () => {
      const { db } = createSqliteD1(); // real migrations 0001-0004 applied by the helper
      const env = envWith({ PORTFOLIO_ACCOUNTS_DB: db });
      const res = await m.call(env, m.name === 'preview' || m.name === 'report' ? 'GET' : 'POST');
      // No session cookie: the handler's entitled-session gate answers 401 -
      // proof the mount passed the request through instead of answering itself.
      expect(res.status).toBe(401);
    });
  }
});

describe('claimAttemptParam', () => {
  it('extracts string, array-first, and missing params', () => {
    expect(claimAttemptParam({ attemptId: 'a-1' })).toBe('a-1');
    expect(claimAttemptParam({ attemptId: ['a-2', 'extra'] })).toBe('a-2');
    expect(claimAttemptParam({})).toBe('');
    expect(claimAttemptParam({ attemptId: 42 })).toBe('42');
  });
});
