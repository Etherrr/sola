/**
 * Native session READ + LOGOUT routes (v0.2 header identity consistency,
 * main 2026-10-25 13:20): the app shell greets the Cloudflare Access
 * identity; when a native session is live the header must reflect THAT
 * identity instead, and Sign out must end the native session.
 *
 * GET info: read-only, one indexed lookup, no rate cost, cache never
 * stored. Returns the session user's latest verified EMAIL identity (never
 * a guessed name) and whether the session is inside the sensitive re-auth
 * window, so re-auth-gated UI can warn honestly.
 * POST logout: same-origin only; revokes the exact live session the cookie
 * names (never all sessions - other devices stay signed in) and clears the
 * cookie. Idempotent: an already-dead session still clears the cookie.
 * Both fail closed: 503 unless NATIVE_AUTH_ENABLED === 'true' + DB binding.
 */
import type { ChallengeDb } from './challenges';
import {
  readLiveSession,
  recentlyAuthenticated,
  revokeSession,
} from './sessions';
import { readSessionCookie, SESSION_COOKIE, type NativeAuthEnv } from './email';
import { requireSameOrigin } from './guards';

const json = (status: number, body: unknown, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

const gate = (env: NativeAuthEnv): ChallengeDb | null =>
  env.NATIVE_AUTH_ENABLED === 'true' && env.PORTFOLIO_ACCOUNTS_DB
    ? env.PORTFOLIO_ACCOUNTS_DB
    : null;

export async function handleNativeSessionInfo(
  req: Request,
  env: NativeAuthEnv,
): Promise<Response> {
  if (req.method !== 'GET')
    return json(405, { error: 'method_not_allowed' }, { allow: 'GET' });
  const db = gate(env);
  if (!db) return json(503, { error: 'unavailable' });
  const id = readSessionCookie(req);
  if (!id) return json(401, { error: 'auth_required' });
  const session = await readLiveSession(db, id);
  if (!session) return json(401, { error: 'session_expired' });
  // The session row names no email; the greeting shows the user's latest
  // VERIFIED email identity. A session with no verified identity at all
  // cannot identify anyone - honest 401, never a guess.
  const identity = await db
    .prepare(
      `SELECT identifier FROM auth_identities
        WHERE user_id = ? AND kind = 'email' AND verified_at IS NOT NULL
        ORDER BY verified_at DESC LIMIT 1`,
    )
    .bind(session.user_id)
    .first<{ identifier: string }>();
  if (!identity) return json(401, { error: 'session_expired' });
  return json(200, {
    status: 'ok',
    email: identity.identifier,
    fresh: recentlyAuthenticated(session),
  });
}

const CLEAR_COOKIE =
  `${SESSION_COOKIE}=; Path=/; Max-Age=0;` + ' HttpOnly; Secure; SameSite=Lax';

export async function handleNativeLogout(
  req: Request,
  env: NativeAuthEnv,
): Promise<Response> {
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  const db = gate(env);
  if (!db) return json(503, { error: 'unavailable' });
  const id = readSessionCookie(req);
  if (id) {
    const session = await readLiveSession(db, id);
    if (session) await revokeSession(db, session.id);
  }
  return json(200, { status: 'ok' }, { 'set-cookie': CLEAR_COOKIE });
}
