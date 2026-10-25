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
  const s = await createSession(db, 'u1');
  cookie = `${SESSION_COOKIE}=${s.id}`;
});

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
  it('requires a session; lists empty initially', async () => {
    expect((await handleAddressesList(req('GET', undefined), env)).status).toBe(401);
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
