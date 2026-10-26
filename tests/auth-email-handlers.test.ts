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

const post = (body: unknown, origin: string | null = 'https://preview.test'): Request =>
  new Request('https://preview.test/api/v1/auth/email/x', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
    },
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
  capture = async (email, code) => {
    captured.push({ email, code });
  };
});
afterEach(() => vi.restoreAllMocks());

const lastCode = (): string => captured[captured.length - 1].code;

describe('email challenge handler', () => {
  it('fail-closed with no sender: 503 and NO code is issued', async () => {
    const r = await handleEmailChallenge(post({ email: 'a@b.co' }), env);
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe('email_provider_not_configured');
    expect(captured).toHaveLength(0);
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM challenges')
      .bind()
      .first<{ n: number }>();
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
      expect((await handleEmailChallenge(post({ email: 'rl@x.co' }), env, capture)).status).toBe(
        200,
      );
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
    expect((await handleEmailVerify(post({ email: 'v@x.co', code: 'deadbeef' }), env)).status).toBe(
      401,
    );
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
      expect(
        (await handleEmailVerify(post({ email: 'lock@x.co', code: 'wrong' + i }), env)).status,
      ).toBe(401);
    const r = await handleEmailVerify(post({ email: 'lock@x.co', code }), env);
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: string }).error).toBe('too_many_attempts');
  });
  it('an expired code is 401 invalid_code and sets no session cookie', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const code = await issue('exp@x.co');
      // Past the 10-minute OTP TTL: expired and wrong codes share one honest
      // error by design (anti-enumeration), and no session is created.
      vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
      const r = await handleEmailVerify(post({ email: 'exp@x.co', code }), env);
      expect(r.status).toBe(401);
      expect(((await r.json()) as { error: string }).error).toBe('invalid_code');
      expect(r.headers.get('set-cookie')).toBeNull();
      const sessions = await db
        .prepare('SELECT COUNT(*) AS n FROM sessions')
        .bind()
        .first<{ n: number }>();
      expect(sessions!.n).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('a new code request supersedes the old one', async () => {
    const first = await issue('sup@x.co');
    const second = await issue('sup@x.co');
    expect((await handleEmailVerify(post({ email: 'sup@x.co', code: first }), env)).status).toBe(
      401,
    );
    expect((await handleEmailVerify(post({ email: 'sup@x.co', code: second }), env)).status).toBe(
      200,
    );
  });
  it('returning user keeps the same account (identity reuse)', async () => {
    const code1 = await issue('ret@x.co');
    const r1 = await handleEmailVerify(post({ email: 'ret@x.co', code: code1 }), env);
    const u1 = ((await r1.json()) as { user: { id: string } }).user.id;
    const code2 = await issue('ret@x.co');
    const r2 = await handleEmailVerify(post({ email: 'ret@x.co', code: code2 }), env);
    const u2 = ((await r2.json()) as { user: { id: string } }).user.id;
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
    const failing: SendCode = async () => {
      throw new Error('smtp down');
    };
    const r = await handleEmailChallenge(post({ email: 'f@x.co' }), env, failing);
    expect(r.status).toBe(502);
    expect(captured).toHaveLength(0);
  });
  it('resend sender posts to the Resend API with the bearer key', async () => {
    const calls: { url: string; auth: string; body: string }[] = [];
    const fakeFetch = (async (
      url: string,
      init: { headers: Record<string, string>; body: string },
    ) => {
      calls.push({ url, auth: init.headers.authorization, body: init.body });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const send = senderFromEnv(
      {
        ...env,
        NATIVE_AUTH_RESEND_API_KEY: 're_test_key',
        NATIVE_AUTH_EMAIL_FROM: 'Sola <signin@auth.solacapitalpartners.com>',
      },
      fakeFetch,
    )!;
    await send('u@x.co', 'abc123');
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].auth).toBe('Bearer re_test_key');
    expect(calls[0].body).toContain('"to":["u@x.co"]');
    expect(calls[0].body).toContain('abc123');
  });
});

describe('strict Origin checks (login CSRF)', () => {
  it('rejects cross-origin and missing-origin auth POSTs before any work', async () => {
    expect(
      (await handleEmailChallenge(post({ email: 'a@b.co' }, 'https://evil.example'), env)).status,
    ).toBe(403);
    expect((await handleEmailChallenge(post({ email: 'a@b.co' }, null), env)).status).toBe(403);
    expect(
      (await handleEmailVerify(post({ email: 'a@b.co', code: 'x' }, 'https://evil.example'), env))
        .status,
    ).toBe(403);
    expect((await handleEmailVerify(post({ email: 'a@b.co', code: 'x' }, null), env)).status).toBe(
      403,
    );
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM challenges')
      .bind()
      .first<{ n: number }>();
    expect(row!.n).toBe(0);
  });
});

describe('Phase 0 front-door budgets (per-IP + global daily send budget)', () => {
  const postIp = (body: unknown, ip: string | null): Request =>
    new Request('https://preview.test/api/v1/auth/email/x', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://preview.test',
        ...(ip ? { 'cf-connecting-ip': ip } : {}),
      },
      body: JSON.stringify(body),
    });

  it('per-IP issue limit: one IP cycling many emails is capped (scope ip)', async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (await handleEmailChallenge(postIp({ email: `u${i}@x.co` }, '203.0.113.7'), env, capture))
          .status,
      ).toBe(200);
    const r = await handleEmailChallenge(postIp({ email: 'u5@x.co' }, '203.0.113.7'), env, capture);
    expect(r.status).toBe(429);
    const body = (await r.json()) as { error: string; scope: string };
    expect(body.scope).toBe('ip');
    expect(captured).toHaveLength(5);
    // A different IP is unaffected.
    expect(
      (await handleEmailChallenge(postIp({ email: 'u5@x.co' }, '203.0.113.8'), env, capture))
        .status,
    ).toBe(200);
  });

  it('a missing cf-connecting-ip shares one conservative bucket, not an escape hatch', async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (await handleEmailChallenge(postIp({ email: `n${i}@x.co` }, null), env, capture)).status,
      ).toBe(200);
    const r = await handleEmailChallenge(postIp({ email: 'n5@x.co' }, null), env, capture);
    expect(r.status).toBe(429);
    expect(((await r.json()) as { scope: string }).scope).toBe('ip');
  });

  it('global daily send budget caps total sends across emails AND IPs (scope global)', async () => {
    env.NATIVE_AUTH_DAILY_SEND_BUDGET = '3';
    for (let i = 0; i < 3; i++)
      expect(
        (
          await handleEmailChallenge(
            postIp({ email: `g${i}@x.co` }, `198.51.100.${i + 1}`),
            env,
            capture,
          )
        ).status,
      ).toBe(200);
    const r = await handleEmailChallenge(
      postIp({ email: 'g3@x.co' }, '198.51.100.9'),
      env,
      capture,
    );
    expect(r.status).toBe(429);
    const body = (await r.json()) as { scope: string; retryAfterSec: number };
    expect(body.scope).toBe('global');
    expect(body.retryAfterSec).toBeGreaterThan(0);
    expect(captured).toHaveLength(3); // no fourth send reached the provider
  });

  it('requests rejected by identity limits do not consume the global send budget', async () => {
    env.NATIVE_AUTH_DAILY_SEND_BUDGET = '3';
    // 3 real sends consume the budget.
    for (let i = 0; i < 3; i++)
      expect(
        (
          await handleEmailChallenge(
            postIp({ email: `k${i}@x.co` }, `192.0.2.${i + 1}`),
            env,
            capture,
          )
        ).status,
      ).toBe(200);
    // This request is per-email rate limited before the budget check and must not
    // consume budget; the budget is already exhausted here, so it must report the
    // per-email scope (identity limits run first), proving check order.
    for (let i = 0; i < 4; i++)
      await handleEmailChallenge(postIp({ email: 'order@x.co' }, '192.0.2.50'), env, capture);
    const blocked = await handleEmailChallenge(
      postIp({ email: 'order@x.co' }, '192.0.2.50'),
      env,
      capture,
    );
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { scope: string }).scope).toBe('email');
    expect(captured).toHaveLength(3); // 3 budget sends + 3 allowed 'order' sends hit per-email cap first
  });

  it('per-IP verify limit: code guessing across many emails from one IP is capped', async () => {
    // 31 codes issued to 31 emails from 31 distinct IPs (issue limits untouched).
    const emails = Array.from({ length: 31 }, (_, i) => `v${i}@x.co`);
    for (let i = 0; i < 31; i++)
      expect(
        (
          await handleEmailChallenge(
            postIp({ email: emails[i] }, `198.51.100.${i + 1}`),
            env,
            capture,
          )
        ).status,
      ).toBe(200);
    // One wrong guess per email from ONE verify IP: no per-email window or
    // per-challenge lockout trips first, so only the per-IP verify cap can fire.
    for (let i = 0; i < 30; i++) {
      const r = await handleEmailVerify(
        postIp({ email: emails[i], code: 'wrong' + i }, '203.0.113.99'),
        env,
      );
      expect(r.status).toBe(401);
    }
    const r = await handleEmailVerify(
      postIp({ email: emails[30], code: 'wrong30' }, '203.0.113.99'),
      env,
    );
    expect(r.status).toBe(429);
    expect(((await r.json()) as { scope: string }).scope).toBe('ip');
    // A different IP is unaffected by the first IP's exhaustion.
    const r2 = await handleEmailVerify(
      postIp({ email: emails[30], code: 'wrong30' }, '203.0.113.100'),
      env,
    );
    expect(r2.status).toBe(401);
  });
});
