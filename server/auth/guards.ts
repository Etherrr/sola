/**
 * Request guards for native auth (reviewer pre-enable conditions, 2026-10-25):
 * - requireSameOrigin: strict Origin check on auth POSTs (login CSRF). A browser
 *   cross-site POST carries a foreign Origin; missing Origin on a mutating auth
 *   request is also rejected (browsers always send it on fetch/form POST).
 * - requireLiveSession: SESSION GUARD ONLY - proves a live native session. It is NOT
 *   an entitlement check and must never be described as one.
 * - requireEntitledSession: the real gate for ANY native-session-protected data route
 *   (reviewer 2026-10-25): composes the session guard with an explicit ACTIVE
 *   entitlement (entitlements row matching the user's verified email identity,
 *   revoked_at IS NULL). Any verified email can hold a session; only entitled
 *   identities may read data. No such route ships before this gate exists.
 */
import { readLiveSession, type SessionRow } from './sessions';
import type { ChallengeDb } from './challenges';
import { readSessionCookie } from './email';

export function requireSameOrigin(req: Request): Response | null {
  const origin = req.headers.get('origin');
  if (!origin) return new Response(JSON.stringify({ error: 'origin_required' }), {
    status: 403, headers: { 'content-type': 'application/json' },
  });
  let host: string;
  try { host = new URL(origin).host; } catch {
    return new Response(JSON.stringify({ error: 'origin_invalid' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    });
  }
  if (host !== new URL(req.url).host)
    return new Response(JSON.stringify({ error: 'origin_mismatch' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    });
  return null;
}

export type NativeIdentity = { userId: string; session: SessionRow };

export async function requireLiveSession(
  req: Request,
  db: ChallengeDb,
): Promise<NativeIdentity | Response> {
  const id = readSessionCookie(req);
  if (!id)
    return new Response(JSON.stringify({ error: 'auth_required' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    });
  const session = await readLiveSession(db, id);
  if (!session)
    return new Response(JSON.stringify({ error: 'session_expired' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    });
  return { userId: session.user_id, session };
}

/** The actual data gate: live session + active entitlement for the session user's
 *  verified email. Returns the identity or a 401/403 Response. */
export async function requireEntitledSession(
  req: Request,
  db: ChallengeDb,
): Promise<NativeIdentity | Response> {
  const base = await requireLiveSession(req, db);
  if (base instanceof Response) return base;
  const identity = await db
    .prepare(
      `SELECT identifier FROM auth_identities
        WHERE user_id = ? AND kind = 'email' ORDER BY verified_at DESC LIMIT 1`,
    )
    .bind(base.userId)
    .first<{ identifier: string }>();
  if (!identity)
    return new Response(JSON.stringify({ error: 'no_verified_identity' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    });
  const entitled = await db
    .prepare(
      `SELECT id FROM entitlements
        WHERE email = ? AND revoked_at IS NULL LIMIT 1`,
    )
    .bind(identity.identifier)
    .first<{ id: string }>();
  if (!entitled)
    return new Response(JSON.stringify({ error: 'not_entitled' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    });
  return base;
}
