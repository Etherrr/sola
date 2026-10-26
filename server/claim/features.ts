/**
 * Claim FEATURE DISCOVERY (plan B.3 /account integration prep, LOCAL ONLY -
 * uncommitted, unpushed, never deployed).
 *
 * The /account page must NEVER call a claim endpoint while the feature is off
 * (reviewer integration requirement: flag OFF or pre-0004 -> no claim fetch on
 * the normal account page). The claim mounts themselves 503 when the flag is
 * absent, so they cannot be the discovery mechanism. This endpoint is: one
 * cheap GET answering whether the claim gate is open, computed from config
 * ONLY - no session, no assertion, no database, no user data.
 *
 * Disclosure: the answer is the deployment's flag state, the same class of
 * information the mounts' public 503 'disabled' shape already reveals. The
 * 0004 deployment-order gate remains ops-level (see server/claim/mount.ts);
 * this endpoint does not and cannot prove schema state.
 */
import { claimGateOpen, type ClaimEnv } from './routes';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
};

export async function handleClaimFeatures(req: Request, env: ClaimEnv): Promise<Response> {
  if (req.method !== 'GET')
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed' } }), {
      status: 405,
      headers: { ...HEADERS, allow: 'GET' },
    });
  return new Response(JSON.stringify({ claim: claimGateOpen(env) }), { status: 200, headers: HEADERS });
}
