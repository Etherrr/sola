/**
 * Request guards for native auth (reviewer pre-enable conditions, 2026-10-25):
 * - requireSameOrigin: strict Origin check on auth POSTs (login CSRF). A browser
 *   cross-site POST carries a foreign Origin; missing Origin on a mutating auth
 *   request is also rejected (browsers always send it on fetch/form POST).
 * - requireLiveSession: SESSION GUARD ONLY - proves a live native session. It is NOT
 *   an entitlement check and must never be described as one.
 * - requireEntitledSession: the real gate for ANY native-session-protected data route
 *   (reviewer 2026-10-25): composes the session guard with an explicit ACTIVE
 *   entitlement (entitlements row matching ANY of the user's verified identities
 *   - email or chain+wallet - revoked_at IS NULL). Any verified identity can
 *   hold a session; only entitled identities may read data. No such route ships
 *   before this gate exists.
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

/** The actual data gate: live session + active entitlement for the session user.
 *  Entitlement match = ANY verified identity of the user (reviewer 2026-10-25):
 *  a verified email identity whose address matches entitlements.email
 *  (case-insensitive both sides), OR a verified wallet identity matching
 *  entitlements.wallet_chain + wallet_address (wallet_evm->ethereum:
 *  case-INSENSITIVE hex compare; wallet_solana->solana: EXACT compare -
 *  base58 Solana addresses are case-sensitive, normalizing them is wrong).
 *  Latest-email-only
 *  matching is a hazard (adding an email flips the checked identity), so every
 *  verified identity is considered. verified_at IS NOT NULL is required even
 *  though the column is NOT NULL today, so a future pending identity cannot
 *  match. Revoked rows never match. Returns the identity or a 401/403 Response. */
export async function requireEntitledSession(
  req: Request,
  db: ChallengeDb,
): Promise<NativeIdentity | Response> {
  const base = await requireLiveSession(req, db);
  if (base instanceof Response) return base;
  const entitled = await db
    .prepare(
      `SELECT e.id FROM entitlements e
        WHERE e.revoked_at IS NULL AND (
          EXISTS (SELECT 1 FROM auth_identities i
                  WHERE i.user_id = ? AND i.kind = 'email'
                    AND i.verified_at IS NOT NULL
                    AND e.email IS NOT NULL
                    AND LOWER(i.identifier) = LOWER(e.email))
          OR EXISTS (SELECT 1 FROM auth_identities i
                  WHERE i.user_id = ?
                    AND i.verified_at IS NOT NULL
                    AND e.wallet_address IS NOT NULL
                    AND ((i.kind = 'wallet_evm' AND e.wallet_chain = 'ethereum'
                          AND LOWER(i.identifier) = LOWER(e.wallet_address))
                      OR (i.kind = 'wallet_solana' AND e.wallet_chain = 'solana'
                          AND i.identifier = e.wallet_address)))
        ) LIMIT 1`,
    )
    .bind(base.userId, base.userId)
    .first<{ id: string }>();
  if (!entitled)
    return new Response(JSON.stringify({ error: 'not_entitled' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    });
  return base;
}
