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
        WHERE pf.user_id = ?
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
          `SELECT bs.asset_id AS assetId, bs.amount AS amount, bs.observed_at AS observedAt
             FROM balance_snapshots bs
             JOIN portfolios pf ON pf.id = bs.portfolio_id
            WHERE pf.user_id = ? AND bs.observed_at = ?
            ORDER BY bs.asset_id`,
        )
        .bind(userId, t)
        .all<ObservedAmount>()
    ).results;
  const latest = await load(latestObservedAt);
  const prior = times.results.length === 2 ? await load(times.results[1].t) : null;
  return { latestObservedAt, prior, latest };
}
