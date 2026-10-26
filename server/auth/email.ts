/**
 * Native email-code sign-in handlers (v0.2 preview). Reviewer handler gates
 * (2026-10-25) implemented here:
 * - fresh server attempt id per verify request (claim binding, challenges.ts);
 * - handler-enforced max-attempt lockout + D1 rate limits (store counts, handler enforces);
 * - __Host-/HttpOnly/SameSite=Lax session cookie;
 * - delivery is an INJECTED sender: tests capture in-process; deployed code sends only
 *   via the configured real provider (Resend). There is no log/console path for codes,
 *   no code in any response body, and without a provider no code is issued at all (503).
 */
import {
  issueChallenge,
  claimChallenge,
  recordFailedAttempt,
  getChallengeState,
  type ChallengeDb,
} from './challenges';
import { createSession } from './sessions';
import { requireSameOrigin } from './guards';
import { createD1Limiter } from '../accounts/d1-limiter';
import type { LimitWindow } from '../accounts/limiter';

export interface NativeAuthEnv {
  NATIVE_AUTH_ENABLED?: string;
  /** Resend API key (Pages secret) and verified from-address; the only deployed sender. */
  NATIVE_AUTH_RESEND_API_KEY?: string;
  NATIVE_AUTH_EMAIL_FROM?: string;
  /** EVM chain id policy for SIWE sign-in (default '1' = mainnet). */
  NATIVE_AUTH_EVM_CHAIN_ID?: string;
  /** Phase 0: global daily OTP send budget (all emails, all IPs, all instances).
   *  Positive integer as a string; unset/invalid falls back to the default below. */
  NATIVE_AUTH_DAILY_SEND_BUDGET?: string;
  PORTFOLIO_ACCOUNTS_DB?: ChallengeDb;
}

/** Delivers a code; throws on failure. Tests inject a capture fake; nothing logs codes. */
export type SendCode = (email: string, code: string) => Promise<void>;

/** Real-provider sender built from env; null when the provider is not configured. */
export function senderFromEnv(env: NativeAuthEnv, fetcher: typeof fetch = fetch): SendCode | null {
  if (!env.NATIVE_AUTH_RESEND_API_KEY || !env.NATIVE_AUTH_EMAIL_FROM) return null;
  return async (email, code) => {
    const r = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.NATIVE_AUTH_RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.NATIVE_AUTH_EMAIL_FROM,
        to: [email],
        subject: 'Your Sola sign-in code',
        text: `Your Sola sign-in code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`,
      }),
    });
    if (!r.ok) throw new Error(`email_send_failed:${r.status}`);
  };
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
export const SESSION_COOKIE = '__Host-sola_session';
const SESSION_MAX_AGE_S = 14 * 24 * 3600;

/** Issue limits per email address: 3 codes per 10 minutes, 10 per day. */
const ISSUE_WINDOWS: LimitWindow[] = [
  { limit: 3, windowMs: 600_000 },
  { limit: 10, windowMs: 86_400_000 },
];
/** Verify attempts per email address (on top of per-challenge lockout). */
const VERIFY_WINDOWS: LimitWindow[] = [{ limit: 15, windowMs: 600_000 }];

/**
 * Phase 0 (reviewer scope 2026-10-26): durable per-IP windows on top of the
 * per-email ones, plus a GLOBAL daily send budget. All three layers are
 * D1-keyed (same fail-closed limiter): per-IP stops one address cycling many
 * emails, and the single shared global counter caps total provider sends per
 * UTC day no matter how many emails, IPs, or isolates are involved.
 */
const ISSUE_IP_WINDOWS: LimitWindow[] = [
  { limit: 5, windowMs: 600_000 },
  { limit: 20, windowMs: 86_400_000 },
];
const VERIFY_IP_WINDOWS: LimitWindow[] = [{ limit: 30, windowMs: 600_000 }];
const DEFAULT_DAILY_SEND_BUDGET = 50;

function dailySendBudget(env: NativeAuthEnv): number {
  const n = env.NATIVE_AUTH_DAILY_SEND_BUDGET
    ? Number.parseInt(env.NATIVE_AUTH_DAILY_SEND_BUDGET, 10)
    : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_SEND_BUDGET;
}

/** Client IP for limiting: Cloudflare's connecting-IP header. A missing header is
 *  not an escape hatch - every request without it shares one conservative bucket. */
function clientIp(req: Request): string {
  const ip = req.headers.get('cf-connecting-ip')?.trim();
  return ip && ip.length <= 64 ? ip : '__unknown__';
}

const json = (status: number, body: unknown, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const normalizeEmail = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
};

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function unavailable(env: NativeAuthEnv): Response | null {
  if (env.NATIVE_AUTH_ENABLED !== 'true')
    return json(503, { error: 'disabled', message: 'Native sign-in is switched off.' });
  if (!env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'not_configured', message: 'Native sign-in is not configured.' });
  return null;
}

export async function handleEmailChallenge(
  req: Request,
  env: NativeAuthEnv,
  sendCode?: SendCode,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  const off = unavailable(env);
  if (off) return off;
  const send = sendCode ?? senderFromEnv(env);
  if (!send)
    return json(503, {
      error: 'email_provider_not_configured',
      message: 'Email delivery is not configured yet.',
      requestId,
    });
  const body = await readBody(req);
  const email = normalizeEmail(body?.email);
  if (!email) return json(400, { error: 'invalid_email', requestId });

  const db = env.PORTFOLIO_ACCOUNTS_DB!;
  const limiter = createD1Limiter(db as never, ISSUE_WINDOWS, 'auth_email_issue');
  const lim = await limiter.check(email);
  if (!lim.allowed)
    return json(429, {
      error: 'rate_limited',
      scope: 'email',
      retryAfterSec: lim.retryAfterSec,
      requestId,
    });

  const ipLimiter = createD1Limiter(db as never, ISSUE_IP_WINDOWS, 'auth_email_issue_ip');
  const ipLim = await ipLimiter.check(clientIp(req));
  if (!ipLim.allowed)
    return json(429, {
      error: 'rate_limited',
      scope: 'ip',
      retryAfterSec: ipLim.retryAfterSec,
      requestId,
    });

  // Global daily send budget, checked LAST so only requests that pass the
  // identity limits consume it; it caps real provider sends, not rejected spam.
  const budgetLimiter = createD1Limiter(
    db as never,
    [{ limit: dailySendBudget(env), windowMs: 86_400_000 }],
    'auth_email_issue_global',
  );
  const budget = await budgetLimiter.check('global');
  if (!budget.allowed)
    return json(429, {
      error: 'rate_limited',
      scope: 'global',
      retryAfterSec: budget.retryAfterSec,
      requestId,
    });

  const issued = await issueChallenge(db, 'email_code', email, CODE_TTL_MS);
  try {
    await send(email, issued.secret);
  } catch {
    return json(502, { error: 'email_send_failed', requestId });
  }
  return json(200, { status: 'ok', expiresAt: issued.expiresAt, requestId });
}

export async function handleEmailVerify(req: Request, env: NativeAuthEnv): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  const off = unavailable(env);
  if (off) return off;
  const body = await readBody(req);
  const email = normalizeEmail(body?.email);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!email || !code) return json(400, { error: 'invalid_request', requestId });

  const db = env.PORTFOLIO_ACCOUNTS_DB!;
  const ipLimiter = createD1Limiter(db as never, VERIFY_IP_WINDOWS, 'auth_email_verify_ip');
  const ipLim = await ipLimiter.check(clientIp(req));
  if (!ipLim.allowed)
    return json(429, {
      error: 'rate_limited',
      scope: 'ip',
      retryAfterSec: ipLim.retryAfterSec,
      requestId,
    });

  const limiter = createD1Limiter(db as never, VERIFY_WINDOWS, 'auth_email_verify');
  const lim = await limiter.check(email);
  if (!lim.allowed)
    return json(429, {
      error: 'rate_limited',
      scope: 'email',
      retryAfterSec: lim.retryAfterSec,
      requestId,
    });

  // Handler-enforced lockout: the store counts attempts; the handler refuses beyond the cap.
  const state = await getChallengeState(db, 'email_code', email);
  if (state && state.attempts >= MAX_CODE_ATTEMPTS && !state.consumed_at)
    return json(429, { error: 'too_many_attempts', message: 'Request a new code.', requestId });

  // Fresh server attempt id per request; a session may be created only when THIS
  // attempt's conditional UPDATE flipped exactly one row.
  const attemptId = crypto.randomUUID();
  const won = await claimChallenge(db, 'email_code', email, code, attemptId);
  if (!won) {
    await recordFailedAttempt(db, 'email_code', email);
    return json(401, { error: 'invalid_code', requestId });
  }

  const userId = await findOrCreateUser(db, email);
  const session = await createSession(db, userId);
  const cookie =
    `${SESSION_COOKIE}=${session.id}; Path=/; Max-Age=${SESSION_MAX_AGE_S};` +
    ' HttpOnly; Secure; SameSite=Lax';
  return json(200, { status: 'ok', user: { id: userId }, requestId }, { 'set-cookie': cookie });
}

async function findOrCreateUser(db: ChallengeDb, email: string): Promise<string> {
  const existing = await db
    .prepare(`SELECT user_id FROM auth_identities WHERE kind = 'email' AND identifier = ?`)
    .bind(email)
    .first<{ user_id: string }>();
  if (existing) return existing.user_id;
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const r1 = await db
    .prepare(`INSERT INTO users (id, status, created_at, updated_at) VALUES (?, 'active', ?, ?)`)
    .bind(userId, now, now)
    .run();
  if (!r1.success) throw new Error('user_insert_failed');
  const r2 = await db
    .prepare(
      `INSERT INTO auth_identities (id, user_id, kind, identifier, verified_at)
       VALUES (?, ?, 'email', ?, ?)`,
    )
    .bind(crypto.randomUUID(), userId, email, now)
    .run();
  if (!r2.success) throw new Error('identity_insert_failed');
  return userId;
}

/** Extract the native session id from the request cookie header. */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}
