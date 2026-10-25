import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import {
  handleEmailChallenge,
  handleEmailVerify,
  readSessionCookie,
  SESSION_COOKIE,
  senderFromEnv,
  type NativeAuthEnv,
  type SendCode,
} from '../server/auth/email';

const post = (body: unknown): Request =>
  new Request('https://preview.test/api/v1/auth/email/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

let db: ReturnType<typeof createSqliteD1>['db'];
let env: NativeAuthEnv;
let captured: { email: string; code: string }[];
let capture: SendCode;

beforeEach(() => {
  ({ db } = createSqliteD1());
  env = {
    NATIVE_AUTH_ENABLED: 'true',
    PORTFOLIO_ACCOUNTS_DB: db,
  };
  captured = [];
  capture = async (email, code) => { captured.push({ email, code }); };
});
afterEach(() => vi.restoreAllMocks());

const lastCode = (): string => captured[captured.length - 1].code;

describe('email challenge handler', () => {
  it('fail-closed with no sender: 503 and NO code is issued', async () => {
    const r = await handleEmailChallenge(post({ email: 'a@b.co' }), env);
    expect(r.status).toBe(503);
    expect((await r.json() as { error: string }).error).toBe('email_provider_not_configured');
    expect(captured).toHaveLength(0);
    const row = await db.prepare("SELECT COUNT(*) AS n FROM challenges").bind().first<{ n: number }>();
    expect(row!.n).toBe(0);
  });
  it('disabled when the feature flag is off', async () => {
    env.NATIVE_AUTH_ENABLED = 'false';
    const r = await handleEmailChallenge(post({ email: 'a@b.co' }), env);
    expect(r.status).toBe(503);
  });
  it('rejects a malformed email and never leaks the code in the response', async () => {
    expect((await handleEmailChallenge(post({ email: 'nope' }), env, capture)).status).toBe(400);
    const r = await handleEmailChallenge(post({ email: 'User@Example.com ' }), env, capture);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).not.toMatch(/code=/);
    expect(body).not.toContain(lastCode());
    expect(captured[0].email).toBe('user@example.com');
  });
  it('rate limits repeated issuance to the same address', async () => {
    for (let i = 0; i < 3; i++)
      expect((await handleEmailChallenge(post({ email: 'rl@x.co' }), env, capture)).status).toBe(200);
    const r = await handleEmailChallenge(post({ email: 'rl@x.co' }), env, capture);
    expect(r.status).toBe(429);
  });
});

describe('email verify handler', () => {
  const issue = async (email: string) => {
    const r = await handleEmailChallenge(post({ email }), env, capture);
    expect(r.status).toBe(200);
    return lastCode();
  };
  it('wrong code is 401 and burns one attempt; only one claim wins (replay fails)', async () => {
    const code = await issue('v@x.co');
    expect((await handleEmailVerify(post({ email: 'v@x.co', code: 'deadbeef' }), env)).status).toBe(401);
    const ok = await handleEmailVerify(post({ email: 'v@x.co', code }), env);
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get('set-cookie')!;
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    // Replay of the same code must fail: the claim UPDATE flips exactly one row once.
    expect((await handleEmailVerify(post({ email: 'v@x.co', code }), env)).status).toBe(401);
  });
  it('locks out after 5 failed attempts on the live challenge', async () => {
    const code = await issue('lock@x.co');
    for (let i = 0; i < 5; i++)
      expect((await handleEmailVerify(post({ email: 'lock@x.co', code: 'wrong' + i }), env)).status).toBe(401);
    const r = await handleEmailVerify(post({ email: 'lock@x.co', code }), env);
    expect(r.status).toBe(429);
    expect((await r.json() as { error: string }).error).toBe('too_many_attempts');
  });
  it('a new code request supersedes the old one', async () => {
    const first = await issue('sup@x.co');
    const second = await issue('sup@x.co');
    expect((await handleEmailVerify(post({ email: 'sup@x.co', code: first }), env)).status).toBe(401);
    expect((await handleEmailVerify(post({ email: 'sup@x.co', code: second }), env)).status).toBe(200);
  });
  it('returning user keeps the same account (identity reuse)', async () => {
    const code1 = await issue('ret@x.co');
    const r1 = await handleEmailVerify(post({ email: 'ret@x.co', code: code1 }), env);
    const u1 = (await r1.json() as { user: { id: string } }).user.id;
    const code2 = await issue('ret@x.co');
    const r2 = await handleEmailVerify(post({ email: 'ret@x.co', code: code2 }), env);
    const u2 = (await r2.json() as { user: { id: string } }).user.id;
    expect(u2).toBe(u1);
  });
});

describe('session cookie parsing', () => {
  it('reads only the exact cookie name', () => {
    const req = new Request('https://x', {
      headers: { cookie: `other=1; ${SESSION_COOKIE}=abc123; theme=dark` },
    });
    expect(readSessionCookie(req)).toBe('abc123');
    expect(readSessionCookie(new Request('https://x'))).toBeNull();
  });
});

describe('sender construction', () => {
  it('no provider configured means no sender at all', () => {
    expect(senderFromEnv(env)).toBeNull();
  });
  it('send failure surfaces 502 and never falls back to logging', async () => {
    const failing: SendCode = async () => { throw new Error('smtp down'); };
    const r = await handleEmailChallenge(post({ email: 'f@x.co' }), env, failing);
    expect(r.status).toBe(502);
    expect(captured).toHaveLength(0);
  });
  it('resend sender posts to the Resend API with the bearer key', async () => {
    const calls: { url: string; auth: string; body: string }[] = [];
    const fakeFetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, auth: init.headers.authorization, body: init.body });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const send = senderFromEnv(
      { ...env, NATIVE_AUTH_RESEND_API_KEY: 're_test_key', NATIVE_AUTH_EMAIL_FROM: 'Sola <signin@auth.solacapitalpartners.com>' },
      fakeFetch,
    )!;
    await send('u@x.co', 'abc123');
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].auth).toBe('Bearer re_test_key');
    expect(calls[0].body).toContain('"to":["u@x.co"]');
    expect(calls[0].body).toContain('abc123');
  });
});
