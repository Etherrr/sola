/**
 * Routing-layer plumbing for the claim endpoints (plan B.3 slice: LOCAL route
 * mounting; independent review of this package pending; uncommitted, unpushed,
 * NEVER deployed).
 *
 * DEPLOYMENT-ORDER HARD GATE: these mounts may only serve traffic when ALL of:
 *   1. migration 0004 applied AND verified on the target database (the handlers'
 *      first claim-schema statement would fail honestly without it, but the flag
 *      is the control - a live 500 is never the schema check);
 *   2. the isolated rehearsal of this exact claim code passed on fresh disposable D1;
 *   3. this mounting package cleared independent review;
 *   4. CLAIM_ENABLED deliberately set to exactly '1' on that environment.
 * CLAIM_ENABLED ships ABSENT on every environment. With the flag absent the
 * mounts answer 503 disabled BEFORE the handler runs and BEFORE any database
 * work (proven by tests/claim-mounts.test.ts with a database object that throws
 * on any use). Enabling the flag on a pre-0004 database violates the deployment
 * order even though the handlers would fail closed.
 */
import { fetchAccessKeys } from '../portfolio/access';
import { claimDisabled, claimGateOpen, type ClaimDeps, type ClaimEnv } from './routes';

/**
 * Production deps for the claim handlers. The mounts take this as a DEFAULTED
 * parameter, so local tests and the sandbox fixture inject the same seams
 * (fixture RS256 JWKS via fetchKeys, fixed clock, fixed ids) through the ACTUAL
 * mount wrappers - genuine authenticated local journeys, no network, no
 * weakening of the auth path (the handlers still fully validate every JWT).
 */
export const claimDeps: ClaimDeps = {
  fetchKeys: fetchAccessKeys,
  now: () => new Date(),
  id: () => crypto.randomUUID(),
};

/**
 * Flag pre-check at the routing layer. Returns the shared 503 disabled response
 * when the gate is closed; the caller must then NOT invoke the handler, so no
 * session, assertion, or database work happens at all. Returns null when the
 * gate is open; the handler repeats the same check (defense in depth).
 */
export function claimMountGate(env: ClaimEnv, requestId: string): Response | null {
  return claimGateOpen(env) ? null : claimDisabled(requestId);
}

/** Single attemptId path-param extraction shared by the report/rollback mounts. */
export function claimAttemptParam(params: Record<string, unknown>): string {
  const v = params.attemptId;
  return Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v);
}
