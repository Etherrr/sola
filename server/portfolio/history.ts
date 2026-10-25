/**
 * History read path (plan Phase C.4 -> §6 Overview): loads recorded
 * observations from the snapshot store so the read model can answer
 * "what changed since the prior observation" truthfully.
 *
 * - Reads ONLY balance_snapshots rows belonging to the caller's OWN portfolio
 *   (caller must already hold an entitled session; this module never widens
 *   identity scope).
 * - PER-NNETWORK BASELINES (reviewer 2026-10-25, MEDIUM): sync runs are
 *   per-network, so latest/prior are computed PER NETWORK. A global
 *   "two newest timestamps" query would compare an Ethereum run against a
 *   Solana run - the other network's holdings would vanish from "latest"
 *   and read as false removals/false additions. `networks[]` carries each
 *   network's own latest COMPLETE timestamp; the merged `latest`/`prior`
 *   are the UNION of the per-network slices (an asset present only in the
 *   other network's slice is never dropped).
 * - "Prior observation" per network = that network's most recent DISTINCT
 *   observed_at strictly before its latest complete one. With only one
 *   observation the honest answer is null - never a fabricated zero baseline.
 * - COMPLETE RUNS ONLY: both latest and prior per network come exclusively
 *   from sync_runs with completeness='complete'. A partial run is NEVER a
 *   comparison baseline.
 * - SCOPE: spot balances only (balance_snapshots). Solana scope is the SOL
 *   balance only - SPL tokens/NFTs are not read, so "no Solana rows" means
 *   "no recorded SOL balance", never "empty Solana wallet".
 * - Consent-withdrawn users have no rows (withdrawal deletes history), so the
 *   honest empty state falls out naturally.
 */
import type { ChallengeDb } from '../auth/challenges';
import type { ObservedAmount } from './read-model';

export type NetworkHistory = {
  network: 'ethereum' | 'solana';
  /** This network's latest distinct COMPLETE-run observation time. */
  latestObservedAt: string;
  latest: ObservedAmount[];
  prior: ObservedAmount[] | null;
};

export type HistorySlice = {
  /** Newest per-network latest COMPLETE observation time (max), null when no
   *  complete history exists anywhere. Per-network times live in networks[]. */
  latestObservedAt: string | null;
  /** TRUE when partial-run observations exist that are NEWER than the latest
   *  complete one (or when only partial history exists). */
  newerPartial: boolean;
  /** UNION of per-network priors; null when NO network has a prior. */
  prior: ObservedAmount[] | null;
  /** UNION of per-network latest slices; empty when no history. */
  latest: ObservedAmount[];
  /** Per-network slices with their own timestamps - the honest baseline for
   *  any delta presentation. */
  networks: NetworkHistory[];
};

const NETWORKS = ['ethereum', 'solana'] as const;

export async function loadBalanceHistory(db: ChallengeDb, userId: string): Promise<HistorySlice> {
  const networks: NetworkHistory[] = [];
  for (const network of NETWORKS) {
    const times = await db
      .prepare(
        `SELECT DISTINCT bs.observed_at AS t
           FROM balance_snapshots bs
           JOIN portfolios pf ON pf.id = bs.portfolio_id
           JOIN sync_runs sr ON sr.id = bs.sync_run_id
          WHERE pf.user_id = ? AND sr.completeness = 'complete' AND bs.network = ?
          ORDER BY bs.observed_at DESC
          LIMIT 2`,
      )
      .bind(userId, network)
      .all<{ t: string }>();
    if (times.results.length === 0) continue;
    const load = async (t: string): Promise<ObservedAmount[]> =>
      (
        await db
          .prepare(
            `SELECT bs.asset_id AS assetId, bs.network AS network, bs.address AS address,
                    'wallet_balance' AS kind, bs.amount AS amount, bs.observed_at AS observedAt
               FROM balance_snapshots bs
               JOIN portfolios pf ON pf.id = bs.portfolio_id
               JOIN sync_runs sr ON sr.id = bs.sync_run_id
              WHERE pf.user_id = ? AND bs.observed_at = ? AND bs.network = ?
                AND sr.completeness = 'complete'
              ORDER BY bs.asset_id`,
          )
          .bind(userId, t, network)
          .all<ObservedAmount>()
      ).results;
    const latestObservedAt = times.results[0].t;
    networks.push({
      network,
      latestObservedAt,
      latest: await load(latestObservedAt),
      prior: times.results.length === 2 ? await load(times.results[1].t) : null,
    });
  }

  const latestObservedAt =
    networks.length === 0 ? null : networks.map((n) => n.latestObservedAt).sort().reverse()[0];

  // Any partial-run observation newer than the newest COMPLETE one (or any
  // partial at all when nothing complete exists) forces the honest label.
  const partialNewer = await db
    .prepare(
      `SELECT 1 AS ok FROM balance_snapshots bs
         JOIN portfolios pf ON pf.id = bs.portfolio_id
         JOIN sync_runs sr ON sr.id = bs.sync_run_id
        WHERE pf.user_id = ? AND sr.completeness = 'partial'
          AND bs.observed_at > COALESCE(?, '')
        LIMIT 1`,
    )
    .bind(userId, latestObservedAt)
    .first<{ ok: number }>();
  const newerPartial = partialNewer !== null;

  if (networks.length === 0) return { latestObservedAt: null, newerPartial, prior: null, latest: [], networks: [] };
  const latest = networks.flatMap((n) => n.latest);
  const priors = networks.flatMap((n) => n.prior ?? []);
  return {
    latestObservedAt,
    newerPartial,
    prior: priors.length > 0 ? priors : null,
    latest,
    networks,
  };
}
