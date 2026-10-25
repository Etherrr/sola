/**
 * Request guards for native auth (reviewer pre-enable conditions, 2026-10-25):
 * - requireSameOrigin: strict Origin check on auth POSTs (login CSRF). A browser
 *   cross-site POST carries a foreign Origin; missing Origin on a mutating auth
 *   request is also rejected (browsers always send it on fetch/form POST).
 * - requireNativeSession: entitlement middleware. Every route that serves native
 *   account data must call this BEFORE reading data; it exists and is tested
 *   before any such route ships.
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

export async function requireNativeSession(
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
