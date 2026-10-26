/**
 * Consented observation snapshots (plan Phase C.4): turns one provider result
 * into IMMUTABLE balance/position/price snapshot rows tied to a sync_run.
 *
 * Rules (architecture §1/§7):
 * - NOTHING is recorded without an active privacy_consents row of kind
 *   'portfolio_snapshots' (explicit consent; withdrawals stop recording).
 * - CONSENT IS ENFORCED INSIDE EVERY WRITE: each content insert is an atomic
 *   INSERT ... SELECT ... WHERE EXISTS(<active consent>), so a consent check
 *   and its write can never be split by a concurrent withdrawal. Withdrawal
 *   revokes FIRST, then deletes: a racing insert either lands before the
 *   revoke (and is deleted) or after it (and is refused by the conditional
 *   insert). No post-withdrawal history can survive.
 * - Snapshots are value-only observations - never P&L, never backfilled with
 *   fabricated history, never UPDATEd once written.
 * - Run-scoped idempotent writes: ids are deterministic hashes whose FIRST
 *   component is the sync_run id, and every insert is ON CONFLICT(id) DO
 *   NOTHING; a redelivered row WITHIN one run is skipped, never duplicated,
 *   never an error, while each run owns its rows exactly (run-membership
 *   verdict, 2026-10-26). Address identity inside the hash is the central
 *   chain-aware addressKey (EVM case-insensitive, Solana base58 EXACT) so
 *   case-distinct Solana addresses keep distinct history.
 * - A partial provider failure records what arrived with its sync_run status;
 *   it never erases or overwrites previously stored history.
 */
import type { ChallengeDb } from '../auth/challenges';
import { addressKey, fromWalletResult, isZero, type Network } from './domain';
import type { ProviderResult } from './provider';

export const SNAPSHOT_CONSENT_KIND = 'portfolio_snapshots';

const ACTIVE_CONSENT = `SELECT 1 FROM privacy_consents
   WHERE user_id = ? AND kind = '${SNAPSHOT_CONSENT_KIND}' AND revoked_at IS NULL`;

const toHex = (b: ArrayBuffer): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

const sha256 = async (s: string): Promise<string> =>
  toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

export async function hasSnapshotConsent(db: ChallengeDb, userId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM privacy_consents
        WHERE user_id = ? AND kind = ? AND revoked_at IS NULL LIMIT 1`,
    )
    .bind(userId, SNAPSHOT_CONSENT_KIND)
    .first<{ ok: number }>();
  return row !== null;
}

/** Consent GRANT writer (plan: history recording starts only after explicit
 *  consent). Idempotent: re-granting while active just refreshes the timestamp;
 *  re-granting after a withdrawal revives the (user, kind, version) row with a
 *  fresh consented_at - the PRIMARY KEY leaves no room for parallel rows. */
export async function grantSnapshotConsent(
  db: ChallengeDb,
  userId: string,
  version = 'v1',
): Promise<void> {
  const now = new Date().toISOString();
  const r = await db
    .prepare(
      `INSERT INTO privacy_consents (user_id, kind, version, consented_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(user_id, kind, version)
       DO UPDATE SET revoked_at = NULL, consented_at = excluded.consented_at`,
    )
    .bind(userId, SNAPSHOT_CONSENT_KIND, version, now)
    .run();
  if (!r.success) throw new Error('consent_grant_failed');
}

/** Consent WITHDRAWAL: revoke FIRST, then delete ALL snapshot history for the
 *  user - INCLUDING the sync_runs rows (reviewer amendment A3, 2026-10-26):
 *  run metadata would leak that history existed, its networks and its times,
 *  so after withdrawal the account must be indistinguishable from
 *  never-observed. Revoke-first ordering plus consent-conditional inserts
 *  guarantees no row can be written after the delete. */
export async function withdrawSnapshotConsent(
  db: ChallengeDb,
  userId: string,
): Promise<{ balances: number; positions: number; prices: number; runs: number }> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE privacy_consents SET revoked_at = ?
        WHERE user_id = ? AND kind = ? AND revoked_at IS NULL`,
    )
    .bind(now, userId, SNAPSHOT_CONSENT_KIND)
    .run();
  return deleteSnapshots(db, userId);
}

/** Delete all snapshot history for the user: portfolio content rows, price
 *  rows AND the sync_runs themselves - nothing about the user's observation
 *  history (content, networks, times) survives (reviewer amendment A3).
 *  Consent must already be revoked when this is called as part of withdrawal. */
export async function deleteSnapshots(db: ChallengeDb, userId: string): Promise<{ balances: number; positions: number; prices: number; runs: number }> {
  const portfolios = await db
    .prepare(`SELECT id FROM portfolios WHERE user_id = ?`)
    .bind(userId)
    .all<{ id: string }>();
  let b = 0, p = 0, pr = 0;
  for (const { id } of portfolios.results) {
    b += (await db.prepare(`DELETE FROM balance_snapshots WHERE portfolio_id = ?`).bind(id).run()).meta?.changes ?? 0;
    p += (await db.prepare(`DELETE FROM position_snapshots WHERE portfolio_id = ?`).bind(id).run()).meta?.changes ?? 0;
  }
  // prices belong to runs, not portfolios: delete rows from this user's runs
  pr += (await db
    .prepare(`DELETE FROM price_observations WHERE sync_run_id IN (SELECT id FROM sync_runs WHERE user_id = ?)`)
    .bind(userId)
    .run()).meta?.changes ?? 0;
  // then the runs themselves: prices/content are gone first (FK order), and
  // with the runs goes every remaining trace (attribution, times, errors).
  const runs =
    (await db.prepare(`DELETE FROM sync_runs WHERE user_id = ?`).bind(userId).run()).meta?.changes ?? 0;
  return { balances: b, positions: p, prices: pr, runs };
}

export type RecordOutcome =
  // skippedDuplicates counts WITHIN-run duplicate inserts only (run-scoped
  // ids, 2026-10-26 verdict); an identical LATER run writes its own fresh rows.
  | { recorded: true; syncRunId: string; balances: number; positions: number; prices: number; skippedDuplicates: number }
  | { recorded: false; reason: 'no_consent' | 'no_portfolio' | 'provider_error' };

/** Bounded error kinds for failed sync attempts - NEVER a raw provider error
 *  string, payload, address or response fragment (reviewer amendment A4). */
export type SyncErrorKind =
  | 'rate_limited'
  | 'timeout'
  | 'unavailable'
  | 'bad_response'
  | 'provider_error'
  | 'simulated_refused';

/** Record a FAILED sync attempt as operational metadata ONLY: the fact that an
 *  attempt on this network failed at this wall-clock time, with a bounded
 *  error kind. No holdings content, no provider detail. Consent-conditional
 *  like every write here. Error rows never advance read baselines, never set
 *  newerPartial/newerUnattributed, and never surface in view responses. */
export async function recordSyncError(
  db: ChallengeDb,
  userId: string,
  network: Network,
  kind: SyncErrorKind,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO sync_runs (id, user_id, requested_at, started_at, completed_at, provider, status, error, completeness, network, observed_at)
       SELECT ?, ?, ?, ?, ?, NULL, 'error', ?, NULL, ?, NULL
       WHERE EXISTS (${ACTIVE_CONSENT})`,
    )
    .bind(crypto.randomUUID(), userId, now, now, now, kind, network, userId)
    .run();
}

/** Record one provider result as snapshots for the user's portfolio. Records
 *  NOTHING when consent is absent (checked atomically inside every insert),
 *  the user has no portfolio, or the provider failed. */
export async function recordObservation(
  db: ChallengeDb,
  userId: string,
  network: Network,
  result: Extract<ProviderResult, { ok: true }>,
): Promise<RecordOutcome> {
  const portfolio = await db
    .prepare(`SELECT id FROM portfolios WHERE user_id = ?`)
    .bind(userId)
    .first<{ id: string }>();
  if (!portfolio) return { recorded: false, reason: 'no_portfolio' };

  const now = new Date().toISOString();
  const anyPartial = result.wallets.some((w) => w.partial || (w.aave && w.aave.status !== 'ok'));
  const syncRunId = crypto.randomUUID();
  // The sync_run insert is itself consent-conditional: if consent is absent or
  // withdrawn at this exact point, NO run (and therefore no content) appears.
  const r = await db
    .prepare(
      `INSERT INTO sync_runs (id, user_id, requested_at, started_at, completed_at, provider, status, error, completeness, network, observed_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?
       WHERE EXISTS (${ACTIVE_CONSENT})`,
    )
    .bind(syncRunId, userId, now, now, now, result.provider, anyPartial ? 'partial' : 'live', anyPartial ? 'partial' : 'complete', network, result.observedAt, userId)
    .run();
  if (!r.success) throw new Error('sync_run_insert_failed');
  if ((r.meta?.changes ?? 0) === 0) return { recorded: false, reason: 'no_consent' };

  let balances = 0;
  let positions = 0;
  let prices = 0;
  let skipped = 0;
  const seenPrices = new Set<string>();

  for (const w of result.wallets) {
    for (const p of fromWalletResult(network, w, result.observedAt)) {
      if (isZero(p.amount)) continue;
      // RUN-SCOPED id (reviewer run-membership verdict, 2026-10-26): the run
      // id is the FIRST hash component, so every run owns its rows exactly -
      // cross-run identical re-observations write FRESH rows and strict
      // run-id reads are exact in both directions (no resurrection, no false
      // empty). ON CONFLICT still guards WITHIN-run redelivery (same run ->
      // same hash -> skip), incl. case-variant EVM address collisions.
      const id = await sha256(
        [syncRunId, portfolio.id, p.kind, p.protocol ?? '', p.asset.assetId, addressKey(p.network, p.address), p.amount, p.observedAt].join('|'),
      );
      if (p.kind === 'wallet_balance') {
        const ins = await db
          .prepare(
            `INSERT INTO balance_snapshots (id, sync_run_id, portfolio_id, network, address, asset_id, amount, observed_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (${ACTIVE_CONSENT})
             ON CONFLICT(id) DO NOTHING`,
          )
          .bind(id, syncRunId, portfolio.id, p.network, p.address, p.asset.assetId, p.amount, p.observedAt, userId)
          .run();
        if ((ins.meta?.changes ?? 0) === 1) balances += 1;
        else skipped += 1;
      } else {
        const ins = await db
          .prepare(
            `INSERT INTO position_snapshots (id, sync_run_id, portfolio_id, protocol, network, address, position, observed_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (${ACTIVE_CONSENT})
             ON CONFLICT(id) DO NOTHING`,
          )
          .bind(
            id,
            syncRunId,
            portfolio.id,
            p.protocol,
            p.network,
            p.address,
            JSON.stringify({ kind: p.kind, asset: p.asset, amount: p.amount, valueUsd: p.valueUsd }),
            p.observedAt,
            userId,
          )
          .run();
        if ((ins.meta?.changes ?? 0) === 1) positions += 1;
        else skipped += 1;
      }
      // price observations: one per distinct asset+quote per run. MULTIPLE
      // quotes per (run, asset) are LEGAL storage - each wallet's resolve can
      // record its own quote - and every quote stays recorded; the READ side
      // picks the most recently observed recorded quote per (run, asset) as
      // the documented presentation rule (reviewer R1 fix, 2026-10-26).
      if (p.price) {
        const pk = [p.asset.assetId, p.price.usd, p.price.observedAt].join('|');
        if (!seenPrices.has(pk)) {
          seenPrices.add(pk);
          // run-scoped TOO: prices join per (sync_run_id, asset) on read, so a
          // cross-run-deduped identical quote would leave the baseline run's
          // holdings falsely UNPRICED (reviewer consistency point).
          const priceId = await sha256(['price', syncRunId, ...pk].join('|'));
          const ins = await db
            .prepare(
              `INSERT INTO price_observations (id, sync_run_id, asset_id, usd, source, price_observed_at)
               SELECT ?, ?, ?, ?, ?, ?
               WHERE EXISTS (${ACTIVE_CONSENT})
               ON CONFLICT(id) DO NOTHING`,
            )
            .bind(priceId, syncRunId, p.asset.assetId, p.price.usd, p.price.source, p.price.observedAt, userId)
            .run();
          if ((ins.meta?.changes ?? 0) === 1) prices += 1;
        }
      }
    }
  }
  // Honest tail: if consent was withdrawn mid-run, the conditional inserts
  // refused everything - report that truthfully instead of "all skipped".
  if (!(await hasSnapshotConsent(db, userId))) return { recorded: false, reason: 'no_consent' };
  return { recorded: true, syncRunId, balances, positions, prices, skippedDuplicates: skipped };
}
