/**
 * v0.2 recorded read routes for the plan §6 pages: Assets, DeFi positions and
 * Risk & Return. Each serves the caller's OWN latest COMPLETE-run recorded
 * positions through the unified read model (read-model.ts) - the SAME
 * normalized positions on every screen, so figures reconcile by construction.
 *
 * Gates, in order, each fail-closed (identical contract to the overview route):
 *   1. GET only.
 *   2. Feature flag: PORTFOLIO_ACCOUNTS must be exactly '1' AND the D1
 *      binding must exist.
 *   3. requireEntitledSession FIRST - 401 without a live native session, 403
 *      without an entitlement.
 *
 * Honesty contract:
 * - RECORDED DATA ONLY: these routes never call a provider. "Empty" is named
 *   precisely: 'no_recorded_observations' (no attributed complete run ever)
 *   vs 'no_holdings_recorded' (baseline runs recorded zero holdings) - never
 *   a zero-portfolio claim either way.
 * - newerPartial forces the "latest COMPLETE observation" label;
 *   newerUnattributed means a newer sync's network coverage was never
 *   recorded (legacy row-less runs only).
 * - Unpriced positions carry valueUsd=null and are never zero-valued; "share"
 *   is a share of the PRICED subtotal only.
 * - Coverage scope stays on the response: spot balances + recorded Aave V3
 *   positions only; Solana coverage is the SOL balance only (no SPL/NFTs).
 * - No P&L, no returns, no yields anywhere: "Not yet calculated" is a
 *   presentation decision for the page, and nothing here invents one.
 */
import type { ChallengeDb } from '../auth/challenges';
import { requireEntitledSession } from '../auth/guards';
import { loadRecordedPositions, loadRunSeries } from './position-history';
import { assetsView, defiView, overviewAllocation, overviewTotals, riskView } from './read-model';

export type ViewsEnv = {
  PORTFOLIO_ACCOUNTS?: string;
  PORTFOLIO_ACCOUNTS_DB?: ChallengeDb;
};

export type ViewKind = 'assets' | 'positions' | 'risk' | 'overview';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export async function handlePortfolioView(req: Request, env: ViewsEnv, view: ViewKind): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  if (env.PORTFOLIO_ACCOUNTS !== '1' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'disabled', message: 'This feature is switched off.' });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const identity = await requireEntitledSession(req, db);
  if (identity instanceof Response) return identity;
  try {
    const h = await loadRecordedPositions(db, identity.userId);
    if (!h.anyBaseline)
      return json(200, {
        status: 'empty',
        reason: 'no_recorded_observations',
        newerPartial: h.newerPartial,
        newerUnattributed: h.newerUnattributed,
      });
    if (h.positions.length === 0)
      return json(200, {
        status: 'empty',
        reason: 'no_holdings_recorded',
        newerPartial: h.newerPartial,
        newerUnattributed: h.newerUnattributed,
        latestCompleteObservedAt: h.latestObservedAt,
        networks: h.networks,
        recordedRunMembership: h.recordedRunMembership,
        // A1: history is served even here - earlier runs stay visible and a
        // complete zero-row run plots at 0 (an actual recorded snapshot).
        ...(view === 'overview' ? { history: await loadRunSeries(db, identity.userId) } : {}),
      });
    const base = {
      status: 'ok' as const,
      view,
      scope: 'recorded_observations_only',
      coverage: 'spot_balances_and_recorded_aave_v3_only',
      solanaScope: 'sol_only',
      latestCompleteObservedAt: h.latestObservedAt,
      newerPartial: h.newerPartial,
      newerUnattributed: h.newerUnattributed,
      networks: h.networks,
      // 'exact' claims RECORDED-RUN MEMBERSHIP only (every serving run owns
      // its rows); 'best_effort_legacy' = a legacy baseline may under-serve.
      recordedRunMembership: h.recordedRunMembership,
    };
    if (view === 'assets') return json(200, { ...base, rows: assetsView(h.positions) });
    if (view === 'positions') return json(200, { ...base, rows: defiView(h.positions) });
    if (view === 'overview')
      return json(200, {
        ...base,
        totals: overviewTotals(h.positions),
        allocation: overviewAllocation(h.positions),
        history: await loadRunSeries(db, identity.userId),
      });
    return json(200, { ...base, risk: riskView(h.positions) });
  } catch {
    return json(503, { error: 'storage_unavailable', message: 'History storage is unavailable. Try again later.' });
  }
}
