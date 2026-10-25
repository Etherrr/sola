import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import {
  handleAddressesList,
  handleAddressAdd,
  handleAddressRename,
  handleAddressRemove,
  validateAddress,
  validateLabel,
  canonicalOf,
} from '../server/portfolio/addresses';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE, type NativeAuthEnv } from '../server/auth/email';
import { toChecksumAddress } from '../server/portfolio/address';

const EVM = toChecksumAddress('8ba1f109551bD432803012645Ac136ddd64DBA72');
const SOL = 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB';

const req = (method: string, body?: unknown, cookie?: string, origin: string | null = 'https://preview.test'): Request =>
  new Request('https://preview.test/api/v1/addresses/x', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

let db: ReturnType<typeof createSqliteD1>['db'];
let raw: ReturnType<typeof createSqliteD1>['raw'];
let env: NativeAuthEnv;
let cookie: string;
beforeEach(async () => {
  ({ db, raw } = createSqliteD1());
  env = { NATIVE_AUTH_ENABLED: 'true', PORTFOLIO_ACCOUNTS_DB: db };
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u1','active',?,?)").bind(now, now).run();
  await entitle('u1', 'u1@x.test');
  const s = await createSession(db, 'u1');
  cookie = `${SESSION_COOKIE}=${s.id}`;
});

/** Verified email identity + active entitlement (the standing data gate). */
const entitle = async (userId: string, email: string) => {
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at) VALUES (?, ?, 'email', ?, ?)")
    .bind(crypto.randomUUID(), userId, email, now).run();
  await db.prepare("INSERT INTO entitlements (id, email, granted_by, created_at) VALUES (?, ?, 'test', ?)")
    .bind(crypto.randomUUID(), email, now).run();
};

describe('validation', () => {
  it('EVM checksummed canonical, Solana exact case-sensitive', () => {
    const evm = validateAddress('ethereum', EVM.toLowerCase())!;
    expect(evm.display).toBe(EVM);
    expect(canonicalOf('ethereum', evm.display)).toBe(EVM.toLowerCase());
    const sol = validateAddress('solana', SOL)!;
    expect(canonicalOf('solana', sol.display)).toBe(SOL); // NOT lowercased
    expect(validateAddress('ethereum', '0x123')).toBeNull();
    expect(validateAddress('bitcoin', EVM)).toBeNull();
    expect(validateLabel(' Main Wallet ')).toBe('Main Wallet');
    expect(validateLabel('')).toBeNull();
    expect(validateLabel('x'.repeat(41))).toBeNull();
    expect(validateLabel('a\u0008b')).toBeNull(); // control char
  });
});

describe('address manager (session-gated)', () => {
  it('requires an ENTITLED session on every method; revoked == unentitled', async () => {
    expect((await handleAddressesList(req('GET', undefined), env)).status).toBe(401);
    // user with a live session but NO entitlement: 403 everywhere
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u9','active',?,?)").bind(now, now).run();
    const s9 = await createSession(db, 'u9');
    const c9 = `${SESSION_COOKIE}=${s9.id}`;
    expect((await handleAddressesList(req('GET', undefined, c9), env)).status).toBe(403);
    expect((await handleAddressAdd(req('POST', { network: 'ethereum', address: EVM, label: 'x' }, c9), env)).status).toBe(403);
    expect((await handleAddressRename(req('POST', { network: 'ethereum', address: EVM, label: 'x' }, c9), env)).status).toBe(403);
    expect((await handleAddressRemove(req('POST', { network: 'ethereum', address: EVM }, c9), env)).status).toBe(403);
    // revoked entitlement: same refusal
    await entitle('u9', 'u9@x.test');
    raw.exec("UPDATE entitlements SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email = 'u9@x.test'");
    expect((await handleAddressesList(req('GET', undefined, c9), env)).status).toBe(403);
    const r = await handleAddressesList(req('GET', undefined, cookie), env);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { addresses: unknown[] }).addresses).toHaveLength(0);
  });

  it('add watched -> list -> rename -> remove -> re-add revives as watched', async () => {
    const add = await handleAddressAdd(req('POST', { network: 'ethereum', address: EVM, label: 'Main' }, cookie), env);
    expect(add.status).toBe(200);
    const added = (await add.json()) as { address: { verification: string; address: string } };
    expect(added.address.verification).toBe('watched');
    expect(added.address.address).toBe(EVM); // checksummed display

    // duplicate add (case-variant) is a conflict, not a second row
    const dup = await handleAddressAdd(req('POST', { network: 'ethereum', address: EVM.toLowerCase(), label: 'Dup' }, cookie), env);
    expect(dup.status).toBe(409);

    const ren = await handleAddressRename(req('POST', { network: 'ethereum', address: EVM, label: 'Cold' }, cookie), env);
    expect(ren.status).toBe(200);

    const rm = await handleAddressRemove(req('POST', { network: 'ethereum', address: EVM }, cookie), env);
    expect(rm.status).toBe(200);
    const list1 = (await (await handleAddressesList(req('GET', undefined, cookie), env)).json()) as { addresses: unknown[] };
    expect(list1.addresses).toHaveLength(0);

    const readd = await handleAddressAdd(req('POST', { network: 'ethereum', address: EVM, label: 'Back' }, cookie), env);
    expect(readd.status).toBe(200);
    const row = await db.prepare('SELECT label, verification, removed_at FROM portfolio_addresses').bind().first<{ label: string; verification: string; removed_at: string | null }>();
    expect(row).toEqual({ label: 'Back', verification: 'watched', removed_at: null });
  });

  it('enforces the per-network cap', async () => {
    for (let i = 0; i < 5; i++) {
      const a = toChecksumAddress((BigInt('0x8ba1f109551bD432803012645Ac136ddd64DBA72') + BigInt(i + 1)).toString(16));
      expect((await handleAddressAdd(req('POST', { network: 'ethereum', address: a, label: `w${i}` }, cookie), env)).status).toBe(200);
    }
    const sixth = toChecksumAddress('1111111111111111111111111111111111111111');
    const r = await handleAddressAdd(req('POST', { network: 'ethereum', address: sixth, label: 'six' }, cookie), env);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe('too_many_addresses');
  });

  it('removal requires a FRESH session; a stale session gets 403 reauth_required', async () => {
    await handleAddressAdd(req('POST', { network: 'solana', address: SOL, label: 'sol' }, cookie), env);
    raw.exec("UPDATE sessions SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes')");
    const r = await handleAddressRemove(req('POST', { network: 'solana', address: SOL }, cookie), env);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe('reauth_required');
    // add/list/rename still work with the stale session (non-destructive)
    expect((await handleAddressesList(req('GET', undefined, cookie), env)).status).toBe(200);
  });

  it("user B cannot touch user A's addresses (per-record authorization)", async () => {
    await handleAddressAdd(req('POST', { network: 'ethereum', address: EVM, label: 'A-main' }, cookie), env);
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO users (id, status, created_at, updated_at) VALUES ('u2','active',?,?)").bind(now, now).run();
    await entitle('u2', 'u2@x.test'); // entitled but owns NOTHING - must 404, not 403
    const s2 = await createSession(db, 'u2');
    const cookie2 = `${SESSION_COOKIE}=${s2.id}`;
    // B sees none of A's addresses
    const listB = (await (await handleAddressesList(req('GET', undefined, cookie2), env)).json()) as { addresses: unknown[] };
    expect(listB.addresses).toHaveLength(0);
    // B cannot rename or remove A's row (404, unchanged)
    expect((await handleAddressRename(req('POST', { network: 'ethereum', address: EVM, label: 'hijack' }, cookie2), env)).status).toBe(404);
    expect((await handleAddressRemove(req('POST', { network: 'ethereum', address: EVM }, cookie2), env)).status).toBe(404);
    const row = await db.prepare('SELECT label, removed_at FROM portfolio_addresses').bind().first<{ label: string; removed_at: string | null }>();
    expect(row!.label).toBe('A-main');
    expect(row!.removed_at).toBeNull();
  });

  it('foreign origin is refused on mutations', async () => {
    const r = await handleAddressAdd(req('POST', { network: 'ethereum', address: EVM, label: 'x' }, cookie, 'https://evil.test'), env);
    expect(r.status).toBe(403);
  });
});

describe('cap race atomicity (both writers)', () => {
  const evmAt = (i: number) => toChecksumAddress('1'.repeat(36) + i.toString(16).padStart(4, '0'));

  it('concurrent adds at 4 rows land exactly 5, loser gets 409 - never 6', async () => {
    for (let i = 0; i < 4; i++)
      expect((await handleAddressAdd(req('POST', { network: 'ethereum', address: evmAt(i), label: `w${i}` }, cookie), env)).status).toBe(200);
    const [r1, r2] = await Promise.all([
      handleAddressAdd(req('POST', { network: 'ethereum', address: evmAt(4), label: 'w4' }, cookie), env),
      handleAddressAdd(req('POST', { network: 'ethereum', address: evmAt(5), label: 'w5' }, cookie), env),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const n = await db.prepare("SELECT COUNT(*) AS n FROM portfolio_addresses WHERE network='ethereum' AND removed_at IS NULL").bind().first<{ n: number }>();
    expect(n!.n).toBe(5);
  });
});
