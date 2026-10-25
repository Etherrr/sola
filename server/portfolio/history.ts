/**
 * History read path (plan Phase C.4 -> §6 Overview): loads recorded
 * observations from the snapshot store so the read model can answer
 * "what changed since the prior observation" truthfully.
 *
 * - Reads ONLY balance_snapshots rows belonging to the caller's OWN portfolio
 *   (caller must already hold an entitled session; this module never widens
 *   identity scope).
 * - "Prior observation" = the most recent DISTINCT observed_at strictly before
 *   the latest one. With only one observation the honest answer is null
 *   ("first recorded observation") - never a fabricated zero baseline.
 * - COMPLETE RUNS ONLY (reviewer 2026-10-25): both the latest and the prior
 *   observation are drawn exclusively from sync_runs with
 *   completeness='complete'. A partial run (e.g. only Solana succeeded) is
 *   NEVER a comparison baseline - otherwise an asset absent from the partial
 *   prior would falsely read as "new" / a gain against zero. When no complete
 *   prior exists the answer is null = "unknown", never zero.
 * - SCOPE: spot balances only (balance_snapshots). DeFi/position history needs
 *   position_snapshots reads before any overall-delta claim; callers must
 *   label deltas as spot-only until then.
 * - Consent-withdrawn users have no rows (withdrawal deletes history), so the
 *   honest empty state falls out naturally.
 */
import type { ChallengeDb } from '../auth/challenges';
import type { ObservedAmount } from './read-model';

export type HistorySlice = {
  /** Latest distinct observation time, null when no history exists. */
  latestObservedAt: string | null;
  /** Amounts at the prior distinct observation, null when none exists. */
  prior: ObservedAmount[] | null;
  /** Amounts at the latest observation (empty when no history). */
  latest: ObservedAmount[];
};

export async function loadBalanceHistory(db: ChallengeDb, userId: string): Promise<HistorySlice> {
  const times = await db
    .prepare(
      `SELECT DISTINCT bs.observed_at AS t
         FROM balance_snapshots bs
         JOIN portfolios pf ON pf.id = bs.portfolio_id
         JOIN sync_runs sr ON sr.id = bs.sync_run_id
        WHERE pf.user_id = ? AND sr.completeness = 'complete'
        ORDER BY bs.observed_at DESC
        LIMIT 2`,
    )
    .bind(userId)
    .all<{ t: string }>();
  if (times.results.length === 0) return { latestObservedAt: null, prior: null, latest: [] };
  const latestObservedAt = times.results[0].t;
  const load = async (t: string): Promise<ObservedAmount[]> =>
    (
      await db
        .prepare(
          `SELECT bs.asset_id AS assetId, bs.network AS network, bs.address AS address,
                  'wallet_balance' AS kind, bs.amount AS amount, bs.observed_at AS observedAt
             FROM balance_snapshots bs
             JOIN portfolios pf ON pf.id = bs.portfolio_id
             JOIN sync_runs sr ON sr.id = bs.sync_run_id
            WHERE pf.user_id = ? AND bs.observed_at = ? AND sr.completeness = 'complete'
            ORDER BY bs.asset_id`,
        )
        .bind(userId, t)
        .all<ObservedAmount>()
    ).results;
  const latest = await load(latestObservedAt);
  const prior = times.results.length === 2 ? await load(times.results[1].t) : null;
  return { latestObservedAt, prior, latest };
}
