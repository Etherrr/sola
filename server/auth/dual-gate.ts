/**
 * Dual-gate: shared-data handlers admit EITHER a valid Cloudflare Access JWT
 * OR a native ENTITLED session; every other caller fails closed. There is NO
 * principal mapping between the two paths: the returned identity is an
 * admission result, never a merge. Owner-keyed legacy handlers (accounts,
 * portfolio/session) stay Access-JWT-only; the claim flow is the sole,
 * explicit, user-performed bridge between the identity spaces.
 *
 * Invariants:
 * - A present cf-access-jwt-assertion must verify; a bad one never falls through
 *   to the native path (fail closed, no downgrade).
 * - With no assertion, a native session must be LIVE and ENTITLED
 *   (requireEntitledSession): anonymous 401, unentitled 403 not_entitled.
 * - When the native path is off, the pre-dual-gate contract is preserved exactly:
 *   missing Access config is a 503 not_configured, a missing token is a 401.
 * - Markets/shared data stay entitled-only: the native path IS the entitlement
 *   check, and the Access path is unchanged from today (the edge allowlist).
 *
 * The gate returns a verdict; each handler shapes its own denial Response so
 * envelopes, headers, requestIds and category-only log throttling stay intact.
 */
import { checkAccessJwt, isValidTeamHost, type KeyFetcher } from '../portfolio/access';
import { readOwnerKey } from '../accounts/handler';
import { requireEntitledSession } from './guards';
import type { ChallengeDb } from './challenges';

export type DualGateEnv = {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  NATIVE_AUTH_ENABLED?: string;
  PORTFOLIO_ACCOUNTS_DB?: ChallengeDb;
};

export type DualIdentity =
  | { kind: 'access'; ownerKey: string | null } // iss#sub; null for service tokens (no user subject)
  | { kind: 'native'; userId: string };

export type DualGateDeps = {
  fetchKeys: KeyFetcher;
  now: () => Date;
};

export type DualGateDeny = {
  ok: false;
  status: number;
  /** Stable machine category, safe to log and to map onto the handler's error envelope. */
  code: 'not_configured' | 'unauthorized' | 'auth_required' | 'session_expired' | 'not_entitled';
  /** Finite reject reason for category-only logs (no token, claim value, email or address). */
  reason: string;
};

export type DualGateResult = ({ ok: true } & DualIdentity) | DualGateDeny;

/** Admits the request or returns a shaped verdict. Never logs private values. */
export async function dualGate(
  req: Request,
  env: DualGateEnv,
  d: DualGateDeps,
): Promise<DualGateResult> {
  const token = req.headers.get('cf-access-jwt-assertion');
  if (token) {
    // Explicit Access assertion: it must verify; no silent downgrade to native.
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)
      return { ok: false, status: 503, code: 'not_configured', reason: 'config_missing' };
    if (!isValidTeamHost(env.ACCESS_TEAM_DOMAIN))
      return { ok: false, status: 503, code: 'not_configured', reason: 'team_host_invalid' };
    const reason = await checkAccessJwt(
      token,
      { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD },
      d.fetchKeys,
      Math.floor(d.now().getTime() / 1000),
    );
    if (reason !== null) return { ok: false, status: 401, code: 'unauthorized', reason };
    return { ok: true, kind: 'access', ownerKey: readOwnerKey(token) };
  }
  // Native path: live + entitled session required. When native auth is off or
  // unconfigured there is no second path: preserve the old contract exactly.
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB) {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !isValidTeamHost(env.ACCESS_TEAM_DOMAIN))
      return { ok: false, status: 503, code: 'not_configured', reason: 'config_missing' };
    return { ok: false, status: 401, code: 'unauthorized', reason: 'no_token' };
  }
  const identity = await requireEntitledSession(req, env.PORTFOLIO_ACCOUNTS_DB);
  if (identity instanceof Response) {
    const body = (await identity.json().catch(() => ({}))) as { error?: string };
    const code =
      body.error === 'not_entitled'
        ? 'not_entitled'
        : body.error === 'session_expired'
          ? 'session_expired'
          : 'auth_required';
    return {
      ok: false,
      status: identity.status,
      code,
      reason: code === 'not_entitled' ? 'not_entitled' : 'no_native_session',
    };
  }
  return { ok: true, kind: 'native', userId: identity.userId };
}

/** Limiter owner for a dual-gated caller: verified iss#sub on the Access path,
 *  the native user id on the native path. Never an email, token, or IP. */
export function dualLimiterKey(identity: DualIdentity): string | null {
  return identity.kind === 'access' ? identity.ownerKey : `native#${identity.userId}`;
}
