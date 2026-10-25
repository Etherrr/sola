import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addAccount,
  clearAccounts,
  listAccounts,
  removeAccount,
  validateEntry,
} from '../features/portfolio/accounts-client';

const ACCT = {
  network: 'ethereum',
  address: '0x' + 'a'.repeat(40),
  label: 'Main',
  createdAt: '2026-10-24T00:00:00.000Z',
  updatedAt: '2026-10-24T00:00:00.000Z',
};

function stubFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal('fetch', async (url: unknown, init?: { method?: string; body?: string }) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('accounts client contract', () => {
  it('parses a strict list response and rejects malformed shapes', async () => {
    stubFetch(200, { requestId: 'r', accounts: [ACCT], limits: { maxPerNetwork: 5 } });
    const ok = await listAccounts();
    expect(ok).toEqual({ kind: 'ok', accounts: [ACCT], maxPerNetwork: 5 });
    stubFetch(200, { requestId: 'r', accounts: [{ ...ACCT, network: 'bitcoin' }] });
    expect((await listAccounts()).kind).toBe('error');
    stubFetch(200, '<html>Access redirect</html>');
    expect((await listAccounts()).kind).toBe('error');
  });
  it('maps 503 disabled/not_configured to off (default-off), storage_unavailable to storage', async () => {
    stubFetch(503, { error: { code: 'disabled', message: 'off' }, requestId: 'r' });
    expect((await listAccounts()).kind).toBe('off');
    stubFetch(503, { error: { code: 'not_configured', message: 'x' }, requestId: 'r' });
    expect((await listAccounts()).kind).toBe('off');
    stubFetch(503, { error: { code: 'storage_unavailable', message: 'x' }, requestId: 'r' });
    expect((await listAccounts()).kind).toBe('storage');
  });
  it('maps 408 to a retryable "took too long" error', async () => {
    stubFetch(408, { error: { code: 'timeout', message: 'x' }, requestId: 'r' });
    expect(await listAccounts()).toEqual({
      kind: 'error',
      message: 'That request took too long. Try again.',
      retryable: true,
    });
  });
  it('maps 401 to signin, 409 to cap, 429 to limited with the server retry delay', async () => {
    stubFetch(401, { error: { code: 'unauthorized', message: 'x' } });
    expect((await addAccount('ethereum', ACCT.address, 'x')).kind).toBe('signin');
    stubFetch(409, { error: { code: 'cap_reached', message: 'x' } });
    expect((await addAccount('ethereum', ACCT.address, 'x')).kind).toBe('cap');
    stubFetch(429, { error: { code: 'rate_limited', message: 'x' } }, { 'retry-after': '42' });
    expect(await addAccount('ethereum', ACCT.address, 'x')).toEqual({ kind: 'limited', retryAfterSeconds: 42 });
  });
  it('sends the documented bodies for add, remove and clear', async () => {
    let calls = stubFetch(200, { requestId: 'r', account: ACCT });
    const added = await addAccount('ethereum', ACCT.address, 'Main');
    expect(added).toEqual({ kind: 'ok', account: ACCT });
    expect(calls[0]).toMatchObject({ method: 'POST', body: JSON.stringify({ network: 'ethereum', address: ACCT.address, label: 'Main' }) });
    calls = stubFetch(200, { requestId: 'r', removed: true });
    expect((await removeAccount('ethereum', ACCT.address)).kind).toBe('ok');
    expect(calls[0].body).toBe(JSON.stringify({ network: 'ethereum', address: ACCT.address }));
    calls = stubFetch(200, { requestId: 'r', cleared: true });
    expect((await clearAccounts()).kind).toBe('ok');
    expect(calls[0].body).toBe(JSON.stringify({ all: true }));
  });
  it('maps network failure to a retryable error without detail invention', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const r = await listAccounts();
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.retryable).toBe(true);
  });
});

describe('validateEntry mirrors the server rules', () => {
  it('normalizes ETH case, trims labels, rejects bad shapes and control characters', () => {
    expect(validateEntry('ethereum', '0x' + 'A'.repeat(40), '  Main  ')).toEqual({
      address: '0x' + 'a'.repeat(40),
      label: 'Main',
    });
    expect(validateEntry('ethereum', '0x123', 'x')).toHaveProperty('error');
    expect(validateEntry('solana', '0x' + 'a'.repeat(40), 'x')).toHaveProperty('error');
    expect(validateEntry('solana', 'So1DemoAddr9' + 'z'.repeat(31), 'x')).toEqual({
      address: 'So1DemoAddr9' + 'z'.repeat(31),
      label: 'x',
    });
    expect(validateEntry('ethereum', '0x' + 'a'.repeat(40), '')).toHaveProperty('error');
    expect(validateEntry('ethereum', '0x' + 'a'.repeat(40), 'x'.repeat(41))).toHaveProperty('error');
    expect(validateEntry('ethereum', '0x' + 'a'.repeat(40), 'a\tb')).toHaveProperty('error');
  });
});
