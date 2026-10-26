/**
 * History read path (plan Phase C.4 -> §6 Overview): loads recorded
 * observations from the snapshot store so the read model can answer
 * "what changed since the prior observation" truthfully.
 *
 * - Reads ONLY balance_snapshots rows belonging to the caller's OWN portfolio
 *   (caller must already hold an entitled session; this module never widens
 *   identity scope).
 * - RUN-ATTRIBUTED PER-NETWORK BASELINES (reviewer R2 fix, 2026-10-26; the
 *   earlier MAX(observed_at)-over-rows baseline was approved-then-reopened):
 *   latest/prior are computed PER NETWORK from the newest COMPLETE sync_runs
 *   ATTRIBUTED to that network (0005 network column; legacy NULL-network runs
 *   attribute via their rows only - see run-baselines.ts). A global
 *   "two newest timestamps" query would compare an Ethereum run against a
 *   Solana run, and a row-timestamp baseline RESURRECTED prior holdings after
 *   a complete run that recorded zero rows (an emptied wallet or a removed
 *   sole address): the baseline run is now the run itself, so a zero-row
 *   instant honestly serves zero rows, with its own label time.
 * - PRIOR per network = the IMMEDIATELY PREVIOUS complete attributed run in
 *   A1 wall-clock order (runs[1]), WHATEVER its instant and row count
 *   (reviewer reconciliation, 2026-10-26): exact run membership permits two
 *   consecutive complete runs at ONE provider instant with DIFFERENT
 *   holdings (a same-instant removal or a removed address), so skipping
 *   same-instant predecessors silently hid a valid delta. A same-instant
 *   prior diffs truthfully ("not in latest observation" / "no change"); a
 *   zero-row prior serves an empty prior ("everything since is an
 *   addition"); a single run has prior null ("first recorded observation") -
 *   never a fabricated zero baseline.
 * - STRICT RUN MEMBERSHIP: a baseline serves exactly its OWN rows (strict
 *   run-id load - see run-baselines.ts); the deleted instant-union design
 *   (newest rows at the instant, preferring the baseline run) is gone.
 * - ORDERING (amendment A1): runs order by wall-clock requested_at with a
 *   deterministic id tiebreak; observed_at is the label time, never an
 *   ordering key.
 * - COMPLETE RUNS ONLY: partial runs never serve a view; an attributed
 *   partial run NEWER than the newest complete baseline sets newerPartial
 *   (amendment A2). Error rows are never baselines and never set the flag.
 * - SCOPE: spot balances only (balance_snapshots). Solana scope is the SOL
 *   balance only - SPL tokens/NFTs are not read, so "no Solana rows" means
 *   "no recorded SOL balance", never "empty Solana wallet".
 * - Consent-withdrawn users have no rows (withdrawal deletes history AND
 *   runs), so the honest empty state falls out naturally.
 */
import type { ChallengeDb } from '../auth/challenges';
import type { Network } from './domain';
import type { ObservedAmount } from './read-model';
import { attributedCompleteRuns, newestAttributedPartialAt } from './run-baselines';

export type NetworkHistory = {
  network: 'ethereum' | 'solana';
  /** The baseline run's observation instant - this network's LABEL time. */
  latestObservedAt: string;
  latest: ObservedAmount[];
  prior: ObservedAmount[] | null;
};

export type HistorySlice = {
  /** Newest per-network baseline instant (max), null when no attributed
   *  complete run exists anywhere. Per-network times live in networks[]. */
  latestObservedAt: string | null;
  /** TRUE when an attributed partial run is NEWER (wall-clock) than the
   *  newest complete baseline (or when only partial history exists). */
  newerPartial: boolean;
  /** UNION of per-network priors; null when NO network has a prior. */
  prior: ObservedAmount[] | null;
  /** UNION of per-network latest slices; empty when no history. */
  latest: ObservedAmount[];
  /** Recorded-RUN membership of the served data (latest AND prior baselines):
   *  'exact' = every serving run is post-fix (run-scoped rows); otherwise
   *  'best_effort_legacy' - a legacy baseline may UNDER-SERVE (never phantom
   *  holdings). Says NOTHING about portfolio completeness, valuation or
   *  provider truth. null when nothing is served. */
  recordedRunMembership: 'exact' | 'best_effort_legacy' | null;
  /** Per-network slices with their own timestamps - the honest baseline for
   *  any delta presentation. */
  networks: NetworkHistory[];
};

const NETWORKS: Network[] = ['ethereum', 'solana'];

/** Spot-balance rows of exactly ONE run on one network (strict membership,
 *  run-membership verdict 2026-10-26: no instant unions, no cross-run
 *  fallback - a run serves exactly the rows it owns). */
async function loadRun(
  db: ChallengeDb,
  userId: string,
  network: Network,
  runId: string,
): Promise<ObservedAmount[]> {
  const r = await db
    .prepare(
      `SELECT bs.asset_id AS assetId, bs.network AS network, bs.address AS address,
              'wallet_balance' AS kind, bs.amount AS amount, bs.observed_at AS observedAt
         FROM balance_snapshots bs
         JOIN portfolios pf ON pf.id = bs.portfolio_id
        WHERE pf.user_id = ? AND bs.sync_run_id = ? AND bs.network = ?
        ORDER BY bs.asset_id`,
    )
    .bind(userId, runId, network)
    .all<ObservedAmount>();
  return r.results;
}

export async function loadBalanceHistory(db: ChallengeDb, userId: string): Promise<HistorySlice> {
  const networks: NetworkHistory[] = [];
  let maxBaselineRequestedAt: string | null = null;
  let anyLegacyServing = false;
  for (const network of NETWORKS) {
    const runs = await attributedCompleteRuns(db, userId, network);
    if (runs.length === 0) continue;
    const baseline = runs[0];
    // Prior = the immediately previous complete attributed run in A1 order,
    // whatever its instant (same-instant predecessors carry real deltas now).
    const priorRun = runs[1] ?? null;
    if (baseline.legacy || (priorRun?.legacy ?? false)) anyLegacyServing = true;
    networks.push({
      network,
      latestObservedAt: baseline.instant,
      latest: await loadRun(db, userId, network, baseline.id),
      prior: priorRun ? await loadRun(db, userId, network, priorRun.id) : null,
    });
    if (maxBaselineRequestedAt === null || baseline.requestedAt > maxBaselineRequestedAt)
      maxBaselineRequestedAt = baseline.requestedAt;
  }

  const latestObservedAt =
    networks.length === 0 ? null : networks.map((n) => n.latestObservedAt).sort().reverse()[0];

  // An attributed partial run NEWER (wall-clock) than the newest complete
  // baseline - or any attributed partial when nothing complete exists -
  // forces the honest label (amendment A2; error rows never do).
  const partialAt = await newestAttributedPartialAt(db, userId);
  const newerPartial =
    partialAt !== null && (maxBaselineRequestedAt === null || partialAt > maxBaselineRequestedAt);

  if (networks.length === 0)
    return { latestObservedAt: null, newerPartial, prior: null, latest: [], networks: [], recordedRunMembership: null };
  const latest = networks.flatMap((n) => n.latest);
  const priors = networks.flatMap((n) => n.prior ?? []);
  return {
    latestObservedAt,
    newerPartial,
    prior: priors.length > 0 ? priors : null,
    latest,
    networks,
    recordedRunMembership: anyLegacyServing ? 'best_effort_legacy' : 'exact',
  };
}
