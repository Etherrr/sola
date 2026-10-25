/**
 * Consented observation snapshots (plan Phase C.4): turns one provider result
 * into IMMUTABLE balance/position/price snapshot rows tied to a sync_run.
 *
 * Rules (architecture §1/§7):
 * - NOTHING is recorded without an active privacy_consents row of kind
 *   'portfolio_snapshots' (explicit consent; withdrawals stop recording).
 * - Snapshots are value-only observations - never P&L, never backfilled with
 *   fabricated history, never UPDATEd once written.
 * - Idempotent: a redelivered identical observation (same portfolio, asset,
 *   amount, observation time) maps to the same deterministic row id and is
 *   skipped - duplicates never double-count history.
 * - A partial provider failure records what arrived with its sync_run status;
 *   it never erases or overwrites previously stored history.
 */
import type { ChallengeDb } from '../auth/challenges';
import { fromWalletResult, isZero } from './domain';
import type { ProviderResult } from './provider';

export const SNAPSHOT_CONSENT_KIND = 'portfolio_snapshots';

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

export type RecordOutcome =
  | { recorded: true; syncRunId: string; balances: number; positions: number; prices: number; skippedDuplicates: number }
  | { recorded: false; reason: 'no_consent' | 'no_portfolio' | 'provider_error' };

/** Record one provider result as snapshots for the user's portfolio. Records
 *  NOTHING when consent is absent, the user has no portfolio, or the provider
 *  failed (a failed run writes no partial garbage). */
export async function recordObservation(
  db: ChallengeDb,
  userId: string,
  result: Extract<ProviderResult, { ok: true }>,
  networkOf: (address: string) => 'ethereum' | 'solana',
): Promise<RecordOutcome> {
  if (!(await hasSnapshotConsent(db, userId))) return { recorded: false, reason: 'no_consent' };
  const portfolio = await db
    .prepare(`SELECT id FROM portfolios WHERE user_id = ?`)
    .bind(userId)
    .first<{ id: string }>();
  if (!portfolio) return { recorded: false, reason: 'no_portfolio' };

  const now = new Date().toISOString();
  const anyPartial = result.wallets.some((w) => w.partial || (w.aave && w.aave.status !== 'ok'));
  const syncRunId = crypto.randomUUID();
  const r = await db
    .prepare(
      `INSERT INTO sync_runs (id, user_id, requested_at, started_at, completed_at, provider, status, error, completeness)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(syncRunId, userId, now, now, now, result.provider, anyPartial ? 'partial' : 'live', anyPartial ? 'partial' : 'complete')
    .run();
  if (!r.success) throw new Error('sync_run_insert_failed');

  let balances = 0;
  let positions = 0;
  let prices = 0;
  let skipped = 0;
  const seenPrices = new Set<string>();

  for (const w of result.wallets) {
    const network = networkOf(w.address);
    for (const p of fromWalletResult(network, w, result.observedAt)) {
      if (isZero(p.amount)) continue;
      const id = await sha256([portfolio.id, p.kind, p.protocol ?? '', p.asset.assetId, p.address.toLowerCase(), p.amount, p.observedAt].join('|'));
      const exists = await db
        .prepare(
          p.kind === 'wallet_balance'
            ? `SELECT 1 AS ok FROM balance_snapshots WHERE id = ?`
            : `SELECT 1 AS ok FROM position_snapshots WHERE id = ?`,
        )
        .bind(id)
        .first<{ ok: number }>();
      if (exists) {
        skipped += 1;
        continue;
      }
      if (p.kind === 'wallet_balance') {
        await db
          .prepare(
            `INSERT INTO balance_snapshots (id, sync_run_id, portfolio_id, network, address, asset_id, amount, observed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, syncRunId, portfolio.id, p.network, p.address, p.asset.assetId, p.amount, p.observedAt)
          .run();
        balances += 1;
      } else {
        await db
          .prepare(
            `INSERT INTO position_snapshots (id, sync_run_id, portfolio_id, protocol, network, address, position, observed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
          )
          .run();
        positions += 1;
      }
      // price observations: one per distinct asset+quote per run
      if (p.price) {
        const pk = [p.asset.assetId, p.price.usd, p.price.observedAt].join('|');
        if (!seenPrices.has(pk)) {
          seenPrices.add(pk);
          const priceId = await sha256(['price', ...pk].join('|'));
          const px = await db
            .prepare(`SELECT 1 AS ok FROM price_observations WHERE id = ?`)
            .bind(priceId)
            .first<{ ok: number }>();
          if (!px) {
            await db
              .prepare(
                `INSERT INTO price_observations (id, sync_run_id, asset_id, usd, source, price_observed_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
              )
              .bind(priceId, syncRunId, p.asset.assetId, p.price.usd, p.price.source, p.price.observedAt)
              .run();
            prices += 1;
          }
        }
      }
    }
  }
  return { recorded: true, syncRunId, balances, positions, prices, skippedDuplicates: skipped };
}

/** Consent withdrawal: delete ALL snapshot history for the user's portfolios.
 *  Sync runs stay as audit metadata (no balance content). */
export async function deleteSnapshots(db: ChallengeDb, userId: string): Promise<{ balances: number; positions: number; prices: number }> {
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
  return { balances: b, positions: p, prices: pr };
}
