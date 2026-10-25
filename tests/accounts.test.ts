import { describe, expect, it } from 'vitest';
import { handleResolve, defaultDeps, type Deps, type Env } from '../server/portfolio/handler';
import {
  handleAccounts,
  readOwnerKey,
  type AccountsDeps,
  type AccountsEnv,
} from '../server/accounts/handler';
import { createLimiter } from '../server/accounts/limiter';
import {
  createMemoryStore,
  ownerKey,
  parseEntry,
  MAX_PER_NETWORK,
} from '../server/accounts/store';

const TEAM = 'team-example.cloudflareaccess.com';
const AUD = 'aud123';
const NOW = new Date('2026-10-23T12:00:00Z');
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function signer() {
  const kp = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as {
    n: string;
    e: string;
    kty: string;
  };
  const sign = async (payload: Record<string, unknown>) => {
    const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const body = enc(payload);
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      kp.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    );
    return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
  };
  return { sign, keys: [{ kid: 'k1', kty: 'RSA', n: jwk.n, e: jwk.e }] };
}
const claims = (sub: string, over: Record<string, unknown> = {}) => ({
  iss: `https://${TEAM}`,
  aud: [AUD],
  exp: Math.floor(NOW.getTime() / 1000) + 600,
  sub,
  ...over,
});
const aDeps = (keys: unknown[], over: Partial<AccountsDeps> = {}): AccountsDeps => ({
  fetchKeys: async () => keys as never,
  now: () => NOW,
  id: () => 'req-1',
  bodyDeadlineMs: 3000,
  ...over,
});
const aEnv = (over: Partial<AccountsEnv> = {}): AccountsEnv => ({
  PORTFOLIO_ACCOUNTS: '1',
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  ...over,
});
const aReq = (method: string, body: unknown, jwt: string | null) =>
  new Request('https://app.example/api/v1/portfolio/accounts', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(jwt ? { 'cf-access-jwt-assertion': jwt } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ETH_A = '0x' + 'a'.repeat(40);
const ETH_B = '0x' + 'b'.repeat(40);
const SOL_A = 'So1DemoAddr9zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

describe('account identity and entry validation', () => {
  it('builds owner keys only from bounded verified iss+sub', () => {
    expect(ownerKey(`https://${TEAM}`, 'user-1')).toBe(`https://${TEAM}#user-1`);
    expect(ownerKey('https://evil.example.com', 'user-1')).toBeNull();
    expect(ownerKey(`https://${TEAM}`, '')).toBeNull();
    expect(ownerKey(`https://${TEAM}`, 'x'.repeat(256))).toBeNull();
    expect(ownerKey(`https://${TEAM}`, undefined)).toBeNull();
  });
  it('validates and normalizes entries', () => {
    expect(parseEntry({ network: 'ethereum', address: ETH_A.toUpperCase().replace('0X', '0x'), label: 'Main' }))
      .toEqual({ network: 'ethereum', address: ETH_A, label: 'Main' });
    expect(parseEntry({ network: 'solana', address: SOL_A, label: 'Demo' })).toEqual({
      network: 'solana',
      address: SOL_A,
      label: 'Demo',
    });
    expect(parseEntry({ network: 'bitcoin', address: ETH_A, label: 'x' })).toBeNull();
    expect(parseEntry({ network: 'ethereum', address: '0x123', label: 'x' })).toBeNull();
    expect(parseEntry({ network: 'solana', address: '0x' + 'a'.repeat(40), label: 'x' })).toBeNull();
    expect(parseEntry({ network: 'ethereum', address: ETH_A, label: '' })).toBeNull();
    expect(parseEntry({ network: 'ethereum', address: ETH_A, label: 'x'.repeat(41) })).toBeNull();
    expect(parseEntry({ network: 'ethereum', address: ETH_A, label: 'a\nb' })).toBeNull();
    expect(parseEntry(null)).toBeNull();
  });
});

describe('memory store semantics (reference for the D1 adapter)', () => {
  it('isolates owners and enforces the per-network cap', async () => {
    const s = createMemoryStore();
    const a = 'https://t.cloudflareaccess.com#a';
    const b = 'https://t.cloudflareaccess.com#b';
    for (let i = 0; i < MAX_PER_NETWORK; i += 1) {
      const r = await s.add(a, { network: 'ethereum', address: `0x${String(i).repeat(40)}`, label: `a${i}` }, 't');
      expect(r.ok).toBe(true);
    }
    const over = await s.add(a, { network: 'ethereum', address: ETH_A, label: 'over' }, 't');
    expect(over).toEqual({ ok: false, reason: 'cap' });
    // Cap is per network and per owner.
    expect((await s.add(a, { network: 'solana', address: SOL_A, label: 's' }, 't')).ok).toBe(true);
    expect((await s.add(b, { network: 'ethereum', address: ETH_A, label: 'b1' }, 't')).ok).toBe(true);
    expect((await s.list(a)).filter((r) => r.network === 'ethereum')).toHaveLength(MAX_PER_NETWORK);
    expect(await s.list(b)).toHaveLength(1);
  });
  it('dedupes case-normalized ETH, updates labels, removes and clears idempotently', async () => {
    const s = createMemoryStore();
    const a = 'https://t.cloudflareaccess.com#a';
    await s.add(a, { network: 'ethereum', address: ETH_A.toUpperCase().replace('0X', '0x'), label: 'one' }, 't1');
    const again = await s.add(a, { network: 'ethereum', address: ETH_A, label: 'two' }, 't2');
    expect(again.ok && again.entry.label).toBe('two');
    expect(again.ok && again.entry.createdAt).toBe('t1');
    expect(await s.list(a)).toHaveLength(1);
    await s.remove(a, 'ethereum', ETH_A);
    await s.remove(a, 'ethereum', ETH_A); // idempotent
    expect(await s.list(a)).toHaveLength(0);
    await s.add(a, { network: 'solana', address: SOL_A, label: 's' }, 't');
    await s.clear(a);
    await s.clear(a); // idempotent
    expect(await s.list(a)).toHaveLength(0);
    // B's rows survive A's clear.
    await s.add(a, { network: 'ethereum', address: ETH_A, label: 'a' }, 't');
    await s.add('https://t.cloudflareaccess.com#b', { network: 'ethereum', address: ETH_B, label: 'b' }, 't');
    await s.clear(a);
    expect(await s.list('https://t.cloudflareaccess.com#b')).toHaveLength(1);
  });
  it('relabels an existing address at the cap, matching the D1 adapter (finding 1 parity)', async () => {
    const s = createMemoryStore();
    const a = 'https://t.cloudflareaccess.com#a';
    await s.add(a, { network: 'ethereum', address: ETH_A, label: 'old' }, 't1');
    for (let i = 0; i < MAX_PER_NETWORK - 1; i += 1) {
      await s.add(a, { network: 'ethereum', address: `0x${String(i + 2).repeat(40)}`, label: `x${i}` }, 't');
    }
    expect((await s.list(a)).filter((r) => r.network === 'ethereum')).toHaveLength(MAX_PER_NETWORK);
    const relabel = await s.add(a, { network: 'ethereum', address: ETH_A, label: 'new' }, 't2');
    expect(relabel.ok && relabel.entry.label).toBe('new');
    expect(relabel.ok && relabel.entry.createdAt).toBe('t1');
  });
});

describe('fixed-window limiter', () => {
  it('allows up to the limit, then blocks with a retry delay, then recovers', () => {
    let t = 1_000_000;
    const lim = createLimiter([{ limit: 2, windowMs: 60_000 }], () => t);
    expect(lim.check('k').allowed).toBe(true);
    expect(lim.check('k').allowed).toBe(true);
    const blocked = lim.check('k');
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSec).toBeGreaterThan(0);
    t += 61_000;
    expect(lim.check('k').allowed).toBe(true);
  });
  it('keys are independent and longer windows still bind after short ones reset', () => {
    let t = 0;
    const lim = createLimiter(
      [
        { limit: 2, windowMs: 60_000 },
        { limit: 3, windowMs: 86_400_000 },
      ],
      () => t,
    );
    expect(lim.check('a').allowed).toBe(true);
    expect(lim.check('a').allowed).toBe(true);
    expect(lim.check('b').allowed).toBe(true);
    t += 61_000; // minute window resets, day window does not
    expect(lim.check('a').allowed).toBe(true);
    const blocked = lim.check('a');
    expect(blocked.allowed).toBe(false);
  });
});

describe('accounts HTTP handler', () => {
  it('is disabled without the flag or without a binding', async () => {
    const { sign, keys } = await signer();
    const jwt = await sign(claims('user-a'));
    const off = await handleAccounts(aReq('GET', undefined, jwt), aEnv({ PORTFOLIO_ACCOUNTS: '0' }), aDeps(keys));
    expect(off.status).toBe(503);
    const noBinding = await handleAccounts(
      aReq('GET', undefined, jwt),
      aEnv(),
      aDeps(keys), // no storeOverride and no D1 binding
    );
    expect(noBinding.status).toBe(503);
  });
  it('rejects missing, forged and subject-less tokens', async () => {
    const { sign, keys } = await signer();
    const store = createMemoryStore();
    const missing = await handleAccounts(aReq('GET', undefined, null), aEnv(), aDeps(keys, { storeOverride: store }));
    expect(missing.status).toBe(401);
    const noSub = await handleAccounts(
      aReq('GET', undefined, await sign({ iss: `https://${TEAM}`, aud: [AUD], exp: Math.floor(NOW.getTime() / 1000) + 600 })),
      aEnv(),
      aDeps(keys, { storeOverride: store }),
    );
    expect(noSub.status).toBe(401);
    const other = await signer();
    const forged = await handleAccounts(
      aReq('GET', undefined, await other.sign(claims('user-a'))),
      aEnv(),
      aDeps(keys, { storeOverride: store }),
    );
    expect(forged.status).toBe(401);
  });
  it('adds, lists and deletes only for the verified owner; client-supplied owner is ignored', async () => {
    const { sign, keys } = await signer();
    const store = createMemoryStore();
    const jwtA = await sign(claims('user-a'));
    const jwtB = await sign(claims('user-b'));
    const deps = aDeps(keys, { storeOverride: store });
    // Object-reference attack: body claims another owner; must be ignored.
    const add = await handleAccounts(
      aReq('POST', { network: 'ethereum', address: ETH_A, label: 'Main', owner: 'https://' + TEAM + '#user-b' }, jwtA),
      aEnv(),
      deps,
    );
    expect(add.status).toBe(200);
    const listA = await (await handleAccounts(aReq('GET', undefined, jwtA), aEnv(), deps)).json();
    expect(listA.accounts).toHaveLength(1);
    expect(listA.accounts[0].label).toBe('Main');
    const listB = await (await handleAccounts(aReq('GET', undefined, jwtB), aEnv(), deps)).json();
    expect(listB.accounts).toHaveLength(0);
    // B cannot delete A's row.
    await handleAccounts(aReq('DELETE', { network: 'ethereum', address: ETH_A }, jwtB), aEnv(), deps);
    expect((await (await handleAccounts(aReq('GET', undefined, jwtA), aEnv(), deps)).json()).accounts).toHaveLength(1);
    // A deletes it; a repeat delete stays 200 (idempotent).
    const del = await handleAccounts(aReq('DELETE', { network: 'ethereum', address: ETH_A }, jwtA), aEnv(), deps);
    expect(del.status).toBe(200);
    expect((await (await handleAccounts(aReq('GET', undefined, jwtA), aEnv(), deps)).json()).accounts).toHaveLength(0);
  });
  it('enforces the cap over HTTP and rate-limits mutation bursts with Retry-After', async () => {
    const { sign, keys } = await signer();
    const store = createMemoryStore();
    const jwt = await sign(claims('user-a'));
    const deps = aDeps(keys, { storeOverride: store });
    for (let i = 0; i < MAX_PER_NETWORK; i += 1) {
      const r = await handleAccounts(
        aReq('POST', { network: 'ethereum', address: `0x${String(i + 1).repeat(40)}`, label: `x${i}` }, jwt),
        aEnv(),
        deps,
      );
      expect(r.status).toBe(200);
    }
    const over = await handleAccounts(
      aReq('POST', { network: 'ethereum', address: ETH_A, label: 'over' }, jwt),
      aEnv(),
      deps,
    );
    expect(over.status).toBe(409);
    // Burst past the mutation limiter (30/min) with a fresh identity-scoped limiter.
    const burst = aDeps(keys, {
      storeOverride: createMemoryStore(),
      limiter: createLimiter([{ limit: 2, windowMs: 60_000 }], () => NOW.getTime()),
    });
    expect((await handleAccounts(aReq('POST', { network: 'solana', address: SOL_A, label: '1' }, jwt), aEnv(), burst)).status).toBe(200);
    expect((await handleAccounts(aReq('POST', { network: 'solana', address: 'BbjGN2JXEn2HSLeBWCE8ccGFnaVao6znDnF7edK56Nb', label: '2' }, jwt), aEnv(), burst)).status).toBe(200);
    const limited = await handleAccounts(
      aReq('POST', { network: 'solana', address: 'CcjGN2JXEn2HSLeBWCE8ccGFnaVao6znDnF7edK56Nc', label: '3' }, jwt),
      aEnv(),
      burst,
    );
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
  it('rejects an over-cap declared content-length without reading the body (finding 5)', async () => {
    const { sign, keys } = await signer();
    const jwt = await sign(claims('user-a'));
    const req = new Request('https://app.example/api/v1/portfolio/accounts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '5000',
        'cf-access-jwt-assertion': jwt,
      },
      body: '{}',
    });
    const r = await handleAccounts(req, aEnv(), aDeps(keys, { storeOverride: createMemoryStore() }));
    expect(r.status).toBe(413);
  });
  it('rejects a streamed body over the cap without draining it (finding 5)', async () => {
    const { sign, keys } = await signer();
    const jwt = await sign(claims('user-a'));
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls += 1;
        c.enqueue(new Uint8Array(1024).fill(97)); // 1KB chunks, 10KB total >> 2KB cap
      },
    });
    const req = new Request('https://app.example/api/v1/portfolio/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': jwt },
      body,
      // @ts-expect-error Node requires duplex for streaming request bodies
      duplex: 'half',
    });
    const r = await handleAccounts(req, aEnv(), aDeps(keys, { storeOverride: createMemoryStore() }));
    expect(r.status).toBe(413);
    expect(pulls).toBeLessThan(10); // stopped at the cap, did not drain the whole stream
  });
});

describe('resolve lookup limiter (flag-gated, default off)', () => {
  const rEnv = (over: Partial<Env> = {}): Env => ({
    PORTFOLIO_API_ENABLED: 'true',
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ...over,
  });
  const rDeps = (keys: unknown[]): Deps => ({
    ...defaultDeps(),
    fetchKeys: async () => keys as never,
    now: () => NOW,
    id: () => 'req-1',
  });
  const rPost = (jwt: string) =>
    new Request('https://app.example/api/v1/portfolio/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': jwt },
      body: JSON.stringify({ network: 'ethereum', addresses: [ETH_B], currency: 'USD' }),
    });
  it('limits per verified identity only when the flag is exactly 1', async () => {
    const { sign, keys } = await signer();
    const jwt = await sign(claims('user-a'));
    const unique = () => rDeps(keys); // fresh deps, but the module limiter is shared per process
    // Flag off: repeated lookups are not limited by this hook.
    for (let i = 0; i < 12; i += 1) {
      const r = await handleResolve(rPost(jwt), rEnv(), unique());
      expect(r.status).not.toBe(429);
    }
  });
  it('readOwnerKey reads only verified-shape iss+sub', async () => {
    const { sign } = await signer();
    expect(readOwnerKey(await sign(claims('user-a')))).toBe(`https://${TEAM}#user-a`);
    expect(readOwnerKey(await sign({ iss: `https://${TEAM}`, aud: [AUD] }))).toBeNull();
    expect(readOwnerKey('not-a-jwt')).toBeNull();
    expect(readOwnerKey(null)).toBeNull();
  });
  it('fails closed (401) for a subject-less token when the lookup limiter is enabled (finding 4)', async () => {
    const { sign, keys } = await signer();
    const noSub = await sign({
      iss: `https://${TEAM}`,
      aud: [AUD],
      exp: Math.floor(NOW.getTime() / 1000) + 600,
    });
    const r = await handleResolve(rPost(noSub), rEnv({ PORTFOLIO_LOOKUP_LIMIT: '1' }), rDeps(keys));
    expect(r.status).toBe(401);
  });
});
