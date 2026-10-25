/**
 * Native wallet sign-in handlers (v0.2 preview): SIWE (EVM) and SIWS (Solana).
 * Message-signature gate ONLY - these endpoints never request, relay or verify a
 * transaction or token-approval signature.
 *
 * Handler gates mirror the email handlers (reviewer, 2026-10-25):
 * strict same-origin POST, feature flag, D1 rate limits, max-attempt lockout,
 * fresh server attempt id per claim, session only when THIS attempt's conditional
 * UPDATE flipped exactly one row, __Host-/HttpOnly/SameSite=Lax cookie.
 * Any verified wallet holds a session; DATA still requires requireEntitledSession.
 * Contract accounts (ERC-1271) and undeployed accounts (ERC-6492) are unsupported
 * and fail closed (see siwe.ts) - a documented gap, not claimed as whole-wallet done.
 */
import {
  claimChallenge,
  getChallengeState,
  issueChallenge,
  recordFailedAttempt,
  type ChallengeDb,
} from './challenges';
import { createSession } from './sessions';
import { requireSameOrigin } from './guards';
import { createD1Limiter } from '../accounts/d1-limiter';
import type { LimitWindow } from '../accounts/limiter';
import { SESSION_COOKIE, type NativeAuthEnv } from './email';
import {
  buildSiweMessage,
  isValidEvmAddress,
  toEip55,
  verifySiweMessage,
} from './siwe';
import {
  buildSiwsMessage,
  isValidSolanaAddress,
  verifySiwsMessage,
} from './siws';

export type WalletChain = 'evm' | 'solana';

const WALLET_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const SESSION_MAX_AGE_S = 14 * 24 * 3600;
const CHALLENGE_WINDOWS: LimitWindow[] = [
  { limit: 5, windowMs: 600_000 },
  { limit: 20, windowMs: 86_400_000 },
];
const VERIFY_WINDOWS: LimitWindow[] = [{ limit: 15, windowMs: 600_000 }];

const json = (status: number, body: unknown, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const kindOf = (chain: WalletChain) => (chain === 'evm' ? 'wallet_evm' : 'wallet_solana');
const linkChainOf = (chain: WalletChain) => (chain === 'evm' ? 'ethereum' : 'solana');

/** Canonical subject + display address. EVM subjects are lowercase (stable key);
 *  Solana subjects/addresses stay EXACT (base58 is case-sensitive). */
function normalizeAddress(chain: WalletChain, raw: unknown): { subject: string; display: string } | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (chain === 'evm') {
    if (!isValidEvmAddress(trimmed)) return null;
    return { subject: trimmed.toLowerCase(), display: toEip55(trimmed) };
  }
  return isValidSolanaAddress(trimmed) ? { subject: trimmed, display: trimmed } : null;
}

const b64decode = (s: string): Uint8Array | null => {
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

function expectedFrom(req: Request, address: string, nonce: string, chain: WalletChain, env: NativeAuthEnv) {
  const url = new URL(req.url);
  const base = {
    domain: url.host,
    uri: `${url.origin}/signin`,
    nonce,
    address,
  };
  if (chain === 'evm')
    return { ...base, chainId: Number(env.NATIVE_AUTH_EVM_CHAIN_ID ?? '1') };
  return base;
}

/** POST {address} -> {message, expiresAt}. The nonce never appears in logs;
 *  it MUST appear in the response so the wallet can sign the exact bound message. */
export async function handleWalletChallenge(
  req: Request,
  env: NativeAuthEnv,
  chain: WalletChain,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== 'true')
    return json(503, { error: 'disabled', message: 'Native sign-in is switched off.', requestId });
  if (!env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'not_configured', message: 'Native sign-in is not configured.', requestId });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'invalid_request', requestId });
  }
  const addr = normalizeAddress(chain, body?.address);
  if (!addr) return json(400, { error: 'invalid_address', requestId });

  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const limiter = createD1Limiter(db as never, CHALLENGE_WINDOWS, `auth_wallet_challenge_${chain}`);
  const lim = await limiter.check(addr.subject);
  if (!lim.allowed)
    return json(429, { error: 'rate_limited', retryAfterSec: lim.retryAfterSec, requestId });

  const issued = await issueChallenge(db, kindOf(chain), addr.subject, WALLET_TTL_MS);
  const issuedAt = new Date().toISOString();
  const exp = expectedFrom(req, addr.display, issued.secret, chain, env);
  const message =
    chain === 'evm'
      ? buildSiweMessage({ ...exp, chainId: (exp as { chainId: number }).chainId, issuedAt, expirationTime: issued.expiresAt })
      : buildSiwsMessage({ ...exp, issuedAt, expirationTime: issued.expiresAt });
  return json(200, { status: 'ok', message, expiresAt: issued.expiresAt, requestId });
}

/** POST {address, message, signature} -> session. EVM signature: 0x-hex;
 *  Solana signature: base64 of the 64-byte ed25519 signature. */
export async function handleWalletVerify(
  req: Request,
  env: NativeAuthEnv,
  chain: WalletChain,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== 'true')
    return json(503, { error: 'disabled', message: 'Native sign-in is switched off.', requestId });
  if (!env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'not_configured', message: 'Native sign-in is not configured.', requestId });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'invalid_request', requestId });
  }
  const addr = normalizeAddress(chain, body?.address);
  const message = typeof body?.message === 'string' ? body.message : '';
  const signature = typeof body?.signature === 'string' ? body.signature : '';
  if (!addr || !message || !signature) return json(400, { error: 'invalid_request', requestId });

  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const limiter = createD1Limiter(db as never, VERIFY_WINDOWS, `auth_wallet_verify_${chain}`);
  const lim = await limiter.check(addr.subject);
  if (!lim.allowed)
    return json(429, { error: 'rate_limited', retryAfterSec: lim.retryAfterSec, requestId });

  const state = await getChallengeState(db, kindOf(chain), addr.subject);
  if (state && state.attempts >= MAX_VERIFY_ATTEMPTS && !state.consumed_at)
    return json(429, { error: 'too_many_attempts', message: 'Request a new sign-in message.', requestId });

  // Verify the signature and every bound field BEFORE touching the challenge store.
  const nonceMatch = message.match(/\nNonce: ([^\n]+)\n/);
  const nonce = nonceMatch?.[1] ?? '';
  const exp = expectedFrom(req, addr.display, nonce, chain, env);
  const verdict =
    chain === 'evm'
      ? verifySiweMessage(message, signature, exp as Parameters<typeof verifySiweMessage>[2])
      : verifySiwsMessage(message, b64decode(signature) ?? new Uint8Array(0), exp);
  if (!verdict.ok) {
    await recordFailedAttempt(db, kindOf(chain), addr.subject);
    return json(401, { error: 'invalid_signature', reason: verdict.error, requestId });
  }

  // Fresh server attempt id; a session exists only when THIS attempt flipped one row.
  const attemptId = crypto.randomUUID();
  const won = await claimChallenge(db, kindOf(chain), addr.subject, nonce, attemptId);
  if (!won) {
    await recordFailedAttempt(db, kindOf(chain), addr.subject);
    return json(401, { error: 'invalid_or_consumed_challenge', requestId });
  }

  const challenge = await db
    .prepare(`SELECT id FROM challenges WHERE kind = ? AND subject = ? AND claim_attempt_id = ?`)
    .bind(kindOf(chain), addr.subject, attemptId)
    .first<{ id: string }>();
  const userId = await findOrCreateWalletUser(db, chain, addr, challenge?.id ?? '');
  const session = await createSession(db, userId);
  const cookie =
    `${SESSION_COOKIE}=${session.id}; Path=/; Max-Age=${SESSION_MAX_AGE_S};` +
    ' HttpOnly; Secure; SameSite=Lax';
  return json(200, { status: 'ok', user: { id: userId }, requestId }, { 'set-cookie': cookie });
}

/** auth_identities UNIQUE(kind, identifier) makes a verified wallet non-transferable:
 *  the same wallet always resolves to the SAME account (never re-linked elsewhere). */
async function findOrCreateWalletUser(
  db: ChallengeDb,
  chain: WalletChain,
  addr: { subject: string; display: string },
  challengeId: string,
): Promise<string> {
  const kind = kindOf(chain);
  const existing = await db
    .prepare(`SELECT user_id FROM auth_identities WHERE kind = ? AND identifier = ?`)
    .bind(kind, addr.subject)
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
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), userId, kind, addr.subject, now)
    .run();
  if (!r2.success) throw new Error('identity_insert_failed');
  const r3 = await db
    .prepare(
      `INSERT INTO wallet_links (chain, address, user_id, verified_at, challenge_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(linkChainOf(chain), addr.display, userId, now, challengeId)
    .run();
  if (!r3.success) throw new Error('wallet_link_insert_failed');
  return userId;
}
