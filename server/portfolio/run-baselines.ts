/**
 * Run-attributed baselines (reviewer R2 fix + amendments, 2026-10-26): read
 * paths key baselines off the latest COMPLETE sync_run ATTRIBUTED to each
 * network - never MAX(observed_at) over rows, which (a) resurrected prior
 * holdings after a complete run that recorded zero rows (emptied wallet,
 * removed sole address) and (b) mixed rows from different runs that shared
 * an observed_at instant.
 *
 * ATTRIBUTION: post-0005 runs carry sync_runs.network + observed_at. Pre-0005
 * (legacy NULL-network) runs attribute to a network ONLY through their
 * snapshot rows - a legacy run's rows all share one network by write
 * construction (sync.ts records one run per network; the EXISTS fallback
 * could theoretically attribute one legacy run to two networks had any
 * historical run spanned networks, but every row load filters by network, so
 * nothing leaks across). Legacy ZERO-ROW runs are unattributable: they never
 * advance a baseline and never invent coverage; newer ones surface via
 * hasNewerUnattributed.
 *
 * ORDERING (amendment A1): runs order by requested_at (local wall-clock,
 * NOT NULL on every row), tiebreak id DESC - NEVER by observed_at (provider
 * clocks can skew across runs). observed_at is the LABEL time only. The rule
 * is identical across legacy and new eras. Runs landing in the same
 * wall-clock millisecond order arbitrarily but deterministically; production
 * syncs are seconds apart (tests space inserts with tick()).
 *
 * STRICT RUN MEMBERSHIP (run-membership verdict, 2026-10-26): post-fix rows
 * carry run-scoped ids and reads load WHERE sync_run_id = baseline.id ONLY -
 * no instant unions, no cross-run fallback. Exact in both directions: no
 * resurrection of same-instant removals, no false empty on identical
 * re-observation.
 *
 * LEGACY MEMBERSHIP IS BEST-EFFORT, NEVER PRESENTED AS EXACT: pre-fix runs
 * wrote under cross-run content-hash dedup, so a row skipped as a duplicate
 * is indistinguishable from a holding that run never observed - per-run
 * membership for legacy runs is IRRECOVERABLE. Legacy runs are read strictly
 * by run id as well; the chosen failure direction is UNDER-SERVE (a legacy
 * baseline may present FEWER holdings than were observed - never phantom
 * holdings). Callers surface recordedRunMembership='best_effort_legacy'
 * whenever any serving baseline (latest OR prior) is legacy-era; 'exact'
 * claims recorded-run membership ONLY - never portfolio completeness,
 * valuation truth, or provider truth.
 */
import type { ChallengeDb } from '../auth/challenges';
import type { Network } from './domain';

export type AttributedRun = {
  id: string;
  /** Wall-clock request time - the ORDERING key (A1). */
  requestedAt: string;
  /** The run's observation instant - the LABEL time (from the 0005 column;
   *  for legacy runs, from the run's own rows on this network - such runs
   *  have rows by definition of legacy attribution). */
  instant: string;
  /** TRUE for pre-0005 runs (network IS NULL): per-run membership is
   *  best-effort and known-incomplete in the same-instant collision case. */
  legacy: boolean;
};

const LEGACY_EXISTS = (table: string) =>
  `EXISTS (SELECT 1 FROM ${table} x WHERE x.sync_run_id = sr.id AND x.network = ?)`;

/** Complete runs attributed to `network`, newest first (A1 ordering). */
export async function attributedCompleteRuns(
  db: ChallengeDb,
  userId: string,
  network: Network,
): Promise<AttributedRun[]> {
  const r = await db
    .prepare(
      `SELECT sr.id AS id, sr.requested_at AS requestedAt,
              COALESCE(
                sr.observed_at,
                (SELECT bs.observed_at FROM balance_snapshots bs
                  WHERE bs.sync_run_id = sr.id AND bs.network = ? LIMIT 1),
                (SELECT ps.observed_at FROM position_snapshots ps
                  WHERE ps.sync_run_id = sr.id AND ps.network = ? LIMIT 1)
              ) AS instant,
              (sr.network IS NULL) AS legacy
         FROM sync_runs sr
        WHERE sr.user_id = ? AND sr.completeness = 'complete'
          AND (sr.network = ?
               OR (sr.network IS NULL AND (${LEGACY_EXISTS('balance_snapshots')} OR ${LEGACY_EXISTS('position_snapshots')})))
        ORDER BY sr.requested_at DESC, sr.id DESC`,
    )
    .bind(network, network, userId, network, network, network)
    .all<{ id: string; requestedAt: string; instant: string | null; legacy: number }>();
  return r.results
    .filter((x) => x.instant !== null)
    .map((x) => ({ id: x.id, requestedAt: x.requestedAt, instant: x.instant as string, legacy: x.legacy === 1 }));
}

/** Wall-clock requested_at of the newest ATTRIBUTED partial run for the user
 *  (any network: the newerPartial flag is global). Attribution: post-0005
 *  network column, or legacy runs via their rows (either snapshot table).
 *  Error rows (completeness NULL) and legacy ROW-LESS runs are NOT partials
 *  (amendment A2). */
export async function newestAttributedPartialAt(db: ChallengeDb, userId: string): Promise<string | null> {
  const r = await db
    .prepare(
      `SELECT MAX(sr.requested_at) AS t
         FROM sync_runs sr
        WHERE sr.user_id = ? AND sr.completeness = 'partial'
          AND (sr.network IS NOT NULL
               OR EXISTS (SELECT 1 FROM balance_snapshots bs WHERE bs.sync_run_id = sr.id)
               OR EXISTS (SELECT 1 FROM position_snapshots ps WHERE ps.sync_run_id = sr.id))`,
    )
    .bind(userId)
    .first<{ t: string | null }>();
  return r?.t ?? null;
}

/** TRUE when a legacy (NULL-network) ROW-LESS, non-error run exists that is
 *  newer than `sinceRequestedAt` (or exists at all when since is null): a
 *  newer sync whose network coverage was never recorded. Error rows are
 *  excluded (amendment A2(ii)); new-era rows always carry a network, so a
 *  NULL-network row is legacy by construction. */
export async function hasNewerUnattributed(
  db: ChallengeDb,
  userId: string,
  sinceRequestedAt: string | null,
): Promise<boolean> {
  const r = await db
    .prepare(
      `SELECT 1 AS ok
         FROM sync_runs sr
        WHERE sr.user_id = ? AND sr.network IS NULL AND sr.status != 'error'
          AND NOT EXISTS (SELECT 1 FROM balance_snapshots bs WHERE bs.sync_run_id = sr.id)
          AND NOT EXISTS (SELECT 1 FROM position_snapshots ps WHERE ps.sync_run_id = sr.id)
          AND sr.requested_at > COALESCE(?, '')
        LIMIT 1`,
    )
    .bind(userId, sinceRequestedAt)
    .first<{ ok: number }>();
  return r !== null;
}
