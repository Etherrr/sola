import { describe, expect, it } from 'vitest';
import { handleAccounts, type AccountsDeps, type AccountsEnv } from '../server/accounts/handler';
import { createD1Store, type D1Like } from '../server/accounts/d1';
import type { AccountsStore } from '../server/accounts/store';
import { createSqliteD1 } from './helpers/d1-sqlite';

// Handler-level freeze contract over ACTUAL HTTP payloads (reviewer requirement):
// claimed owner -> 409 legacy_writes_closed on POST and DELETE, rows retained;
// genuinely absent -> 200 idempotent. The JWT harness mirrors tests/accounts.test.ts.
const TEAM = 'team-example.cloudflareaccess.com';
const AUD = 'aud123';
const NOW = new Date('2026-10-23T12:00:00Z');
const SUB = 'user-a';
const OWNER = `https://${TEAM}#${SUB}`;
const ETH = `0x${'1'.repeat(40)}`;
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function signer() {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as { n: string; e: string; kty: string };
  const sign = async (payload: Record<string, unknown>) => {
    const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const body = enc(payload);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
  };
  return { sign, keys: [{ kid: 'k1', kty: 'RSA', n: jwk.n, e: jwk.e }] };
}

function harness(db: ReturnType<typeof createSqliteD1>['db'], keys: unknown[]) {
  const deps: AccountsDeps = {
    fetchKeys: async () => keys as never,
    now: () => NOW,
    id: () => 'req-1',
    bodyDeadlineMs: 3000,
    storeOverride: createD1Store(db),
  };
  const env: AccountsEnv = { PORTFOLIO_ACCOUNTS: '1', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const req = (method: string, body: unknown, jwt: string | null) =>
    new Request('https://app.example/api/v1/portfolio/accounts', {
      method,
      headers: { 'content-type': 'application/json', ...(jwt ? { 'cf-access-jwt-assertion': jwt } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { deps, env, req };
}

async function claimed(db: ReturnType<typeof createSqliteD1>['db']) {
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u-1', 'active', 't0', 't0')").bind().run();
  await db
    .prepare("INSERT INTO claims_ledger (id, owner_key, user_id, state, created_at) VALUES ('att-1', ?, 'u-1', 'claimed', 't2')")
    .bind(OWNER)
    .run();
}

const jwtFor = (sign: (p: Record<string, unknown>) => Promise<string>) =>
  sign({ iss: `https://${TEAM}`, aud: [AUD], exp: Math.floor(NOW.getTime() / 1000) + 600, sub: SUB });

describe('HTTP freeze contract (actual payloads)', () => {
  it('POST while claimed -> 409 legacy_writes_closed, nothing written', async () => {
    const { db } = createSqliteD1();
    const { sign, keys } = await signer();
    const { deps, env, req } = harness(db, keys);
    await claimed(db);
    const res = await handleAccounts(req('POST', { network: 'ethereum', address: ETH, label: 'x' }, await jwtFor(sign)), env, deps);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('legacy_writes_closed');
    expect(body.error?.message).toBe('These addresses are managed in your new account. Make changes there.');
    const n = await db.prepare('SELECT COUNT(*) AS n FROM tracked_addresses WHERE owner_issuer_subject = ?1').bind(OWNER).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('DELETE one while claimed -> 409 legacy_writes_closed, row retained', async () => {
    const { db } = createSqliteD1();
    const { sign, keys } = await signer();
    const { deps, env, req } = harness(db, keys);
    const store = createD1Store(db);
    await store.add(OWNER, { network: 'ethereum', address: ETH, label: 'x' }, 't1');
    await claimed(db);
    const res = await handleAccounts(req('DELETE', { network: 'ethereum', address: ETH }, await jwtFor(sign)), env, deps);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('legacy_writes_closed');
    const n = await db.prepare('SELECT COUNT(*) AS n FROM tracked_addresses WHERE owner_issuer_subject = ?1').bind(OWNER).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('DELETE all while claimed -> 409 legacy_writes_closed, rows retained', async () => {
    const { db } = createSqliteD1();
    const { sign, keys } = await signer();
    const { deps, env, req } = harness(db, keys);
    const store = createD1Store(db);
    await store.add(OWNER, { network: 'ethereum', address: ETH, label: 'x' }, 't1');
    await claimed(db);
    const res = await handleAccounts(req('DELETE', { all: true }, await jwtFor(sign)), env, deps);
    expect(res.status).toBe(409);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM tracked_addresses WHERE owner_issuer_subject = ?1').bind(OWNER).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('DELETE a genuinely absent address (no claim) -> 200 removed idempotent', async () => {
    const { db } = createSqliteD1();
    const { sign, keys } = await signer();
    const { deps, env, req } = harness(db, keys);
    const res = await handleAccounts(req('DELETE', { network: 'ethereum', address: ETH }, await jwtFor(sign)), env, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { removed?: boolean };
    expect(body.removed).toBe(true);
  });

  it('DELETE all on an empty account (no claim) -> 200 cleared idempotent', async () => {
    const { db } = createSqliteD1();
    const { sign, keys } = await signer();
    const { deps, env, req } = harness(db, keys);
    const res = await handleAccounts(req('DELETE', { all: true }, await jwtFor(sign)), env, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cleared?: boolean };
    expect(body.cleared).toBe(true);
  });
});

// HTTP 5xx on the bounded-misclassification window (reviewer requirement), driven through
// the REAL adapter + REAL handler over ACTUAL HTTP payloads with a controlled mock D1:
// guarded write rejected, rows retained, no active claim -> 500 storage_error, never 200.
function mockD1(opts: { rowPresent: boolean; rowCount: number; claimed: boolean }): D1Like {
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          void _args;
          return {
            async run() {
              return { success: true, meta: { changes: 0 } };
            },
            async all<T>() {
              return { results: [] as T[] };
            },
            async first<T>(): Promise<T | null> {
              if (sql.includes('claims_ledger')) return (opts.claimed ? { x: 1 } : null) as unknown as T | null;
              if (sql.includes('COUNT(*)')) return { n: opts.rowCount } as unknown as T;
              return (opts.rowPresent ? { x: 1 } : null) as unknown as T | null;
            },
          };
        },
      };
    },
    async batch() {
      return [];
    },
  };
}

function harnessStore(storeOverride: AccountsStore, keys: unknown[]) {
  const deps: AccountsDeps = {
    fetchKeys: async () => keys as never,
    now: () => NOW,
    id: () => 'req-1',
    bodyDeadlineMs: 3000,
    storeOverride,
  };
  const env: AccountsEnv = { PORTFOLIO_ACCOUNTS: '1', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const req = (method: string, body: unknown, jwt: string | null) =>
    new Request('https://app.example/api/v1/portfolio/accounts', {
      method,
      headers: { 'content-type': 'application/json', ...(jwt ? { 'cf-access-jwt-assertion': jwt } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { deps, env, req };
}

describe('HTTP 5xx on bounded misclassification (controlled adapter)', () => {
  it('DELETE one with the row RETAINED and no active claim -> 500 storage_error, never false 200', async () => {
    const { sign, keys } = await signer();
    const { deps, env, req } = harnessStore(createD1Store(mockD1({ rowPresent: true, rowCount: 1, claimed: false })), keys);
    const res = await handleAccounts(req('DELETE', { network: 'ethereum', address: ETH }, await jwtFor(sign)), env, deps);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('storage_error');
  });
  it('DELETE all with rows RETAINED and no active claim -> 500 storage_error, never false 200', async () => {
    const { sign, keys } = await signer();
    const { deps, env, req } = harnessStore(createD1Store(mockD1({ rowPresent: true, rowCount: 2, claimed: false })), keys);
    const res = await handleAccounts(req('DELETE', { all: true }, await jwtFor(sign)), env, deps);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('storage_error');
  });
});
