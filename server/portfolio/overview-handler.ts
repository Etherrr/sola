/**
 * v0.2 Overview READ route (plan Phase C -> §6 Overview): the first wired
 * consumer of the reviewed snapshot history. Returns the caller's OWN
 * recorded spot-balance history so the Overview "What changed" section reads
 * real data instead of demo fixtures.
 *
 * Gates, in order, each fail-closed:
 *   1. GET only.
 *   2. Feature flag: PORTFOLIO_ACCOUNTS must be exactly '1' AND the D1
 *      binding must exist (same contract as the accounts route).
 *   3. requireEntitledSession FIRST (reviewer invariant: data routes start
 *      from it, never bolt it on) - 401 without a live native session, 403
 *      without an entitlement. Native auth is not yet enabled on preview, so
 *      this route honestly answers 401 there until it is.
 *
 * Honesty contract (reviewed history module): deltas compare the latest
 * COMPLETE observation against the prior complete one; newerPartial forces
 * the "latest COMPLETE observation" label; scope is spot balances ONLY -
 * callers must not present this as whole-portfolio change.
 */
import type { ChallengeDb } from '../auth/challenges';
import { requireEntitledSession } from '../auth/guards';
import { loadBalanceHistory } from './history';

export type OverviewEnv = {
  PORTFOLIO_ACCOUNTS?: string;
  PORTFOLIO_ACCOUNTS_DB?: ChallengeDb;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export async function handleOverview(req: Request, env: OverviewEnv): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  if (env.PORTFOLIO_ACCOUNTS !== '1' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'disabled', message: 'This feature is switched off.' });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const identity = await requireEntitledSession(req, db);
  if (identity instanceof Response) return identity;
  try {
    const h = await loadBalanceHistory(db, identity.userId);
    if (!h.latestObservedAt)
      return json(200, {
        status: 'empty',
        reason: 'no_recorded_observations',
        newerPartial: h.newerPartial,
      });
    return json(200, {
      status: 'ok',
      // Spot balances only; Solana coverage is the SOL balance only (no SPL
      // tokens/NFTs) - "no Solana rows" never means "empty Solana wallet".
      scope: 'spot_balances_only',
      solanaScope: 'sol_only',
      latestCompleteObservedAt: h.latestObservedAt,
      newerPartial: h.newerPartial,
      // 'exact' claims RECORDED-RUN MEMBERSHIP only; 'best_effort_legacy' =
      // a legacy latest/prior baseline may under-serve (never phantom).
      recordedRunMembership: h.recordedRunMembership,
      latest: h.latest,
      prior: h.prior,
      // Per-network slices with their own timestamps: the honest baseline for
      // deltas (reviewer MEDIUM - never compare one network against another).
      networks: h.networks,
    });
  } catch {
    return json(503, { error: 'storage_unavailable', message: 'History storage is unavailable. Try again later.' });
  }
}
