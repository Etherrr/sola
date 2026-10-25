/**
 * Snapshot-consent routes (plan: opt-in background read-only snapshots,
 * default OFF until the user consents, clearly defined cadence/retention).
 * Grant enables recording on refresh; withdrawal revokes FIRST and deletes
 * all recorded snapshot content (handled inside snapshots.ts). Session-gated
 * to the entitled user, same-origin CSRF on mutations, per-user D1 limits.
 */
import { requireSameOrigin, requireEntitledSession } from '../auth/guards';
import { createD1Limiter } from '../accounts/d1-limiter';
import type { LimitWindow } from '../accounts/limiter';
import type { NativeAuthEnv } from '../auth/email';
import {
  grantSnapshotConsent,
  withdrawSnapshotConsent,
  hasSnapshotConsent,
} from './snapshots';

const json = (status: number, body: unknown, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(body), {
    status,
    // Consent state is session-private; never cached (reviewer, 0f49162 note a).
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

const CONSENT_WINDOWS: LimitWindow[] = [{ limit: 20, windowMs: 600_000 }];

/** GET: current consent state for the session user. */
export async function handleSnapshotConsentStatus(req: Request, env: NativeAuthEnv): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'GET')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'GET' });
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'unavailable', requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const identity = await requireEntitledSession(req, db);
  if (identity instanceof Response) return identity;
  const consented = await hasSnapshotConsent(db, identity.userId);
  return json(200, { status: 'ok', consented, requestId });
}

/** POST {action:'grant'|'withdraw'}: change consent. Withdrawal reports how
 *  many snapshot rows were deleted so the UI can state it honestly. */
export async function handleSnapshotConsentChange(req: Request, env: NativeAuthEnv): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'unavailable', requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const identity = await requireEntitledSession(req, db);
  if (identity instanceof Response) return identity;
  const userId = identity.userId;
  const lim = await createD1Limiter(db as never, CONSENT_WINDOWS, 'portfolio_snapshot_consent').check(userId);
  if (!lim.allowed)
    return json(429, { error: 'rate_limited', retryAfterSec: lim.retryAfterSec, requestId });
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action === 'grant') {
    await grantSnapshotConsent(db, userId);
    return json(200, { status: 'ok', consented: true, requestId });
  }
  if (body?.action === 'withdraw') {
    const deleted = await withdrawSnapshotConsent(db, userId);
    return json(200, { status: 'ok', consented: false, deleted, requestId });
  }
  return json(400, { error: 'invalid_request', requestId });
}
