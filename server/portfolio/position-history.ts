/**
 * Recorded-positions read path (plan §6 pages: Assets / DeFi / Risk & Return):
 * loads the caller's OWN latest COMPLETE-run recorded positions - wallet
 * balances AND protocol positions - plus their recorded prices, so the three
 * read views can serve REAL recorded data. NO provider calls on read: every
 * row comes from the snapshot store written by sync runs.
 *
 * - RUN-ATTRIBUTED PER-NETWORK BASELINES (reviewer R2 fix, 2026-10-26):
 *   baselines are the newest COMPLETE sync_runs ATTRIBUTED to each network
 *   (0005 network column; legacy NULL-network runs attribute via their rows
 *   only - see run-baselines.ts). A complete run that recorded ZERO rows
 *   (emptied wallet, removed sole address) IS the baseline: the view then
 *   serves that instant's zero rows with the run's own label time - prior
 *   holdings are NEVER resurrected (an earlier row-timestamp design did, and
 *   the semantics claims made for it on 2026-10-26 were retracted).
 * - ZERO OBSERVATIONS vs NEVER OBSERVED: `anyBaseline` distinguishes them -
 *   no attributed complete run anywhere means never observed; attributed
 *   complete runs with zero rows at their instants mean recorded-and-empty.
 * - STRICT RUN MEMBERSHIP (run-membership verdict, 2026-10-26): a baseline
 *   serves exactly its OWN rows (WHERE sync_run_id = baseline.id) - no
 *   instant unions. Run-scoped write ids make this exact in both directions
 *   (no resurrection of same-instant removals, no false empty on identical
 *   re-observation). LEGACY runs are read strictly too and may UNDER-SERVE
 *   (never phantom holdings); recordedRunMembership marks them.
 * - ORDERING (amendment A1): runs order by wall-clock requested_at with a
 *   deterministic id tiebreak; observed_at is the label time, never an
 *   ordering key.
 * - PARTIAL/ERROR (amendment A2): partial runs never serve a view; an
 *   ATTRIBUTED partial run (including a new-era row-less one) NEWER than the
 *   newest complete baseline sets newerPartial. Error rows never advance
 *   baselines and never set either flag. newerUnattributed marks LEGACY
 *   row-less runs newer than the baseline - a newer sync whose network
 *   coverage was never recorded.
 * - RECORDED PRICES (reviewer R1 fix): multiple quotes per (run, asset) are
 *   legal storage (each wallet's resolve may record its own quote); the view
 *   values holdings at the MOST RECENTLY OBSERVED recorded quote per
 *   (run, asset) - the documented presentation rule - so holdings NEVER
 *   double-count. All quotes remain stored.
 * - Consent-withdrawn users have no rows (withdrawal deletes history AND
 *   runs), so the honest empty state falls out naturally.
 * - Fail-closed on unreadable rows: a corrupt recorded position JSON throws;
 *   the handler answers storage_unavailable rather than fabricate numbers.
 * - Read-path asset refs: symbol/decimals are DERIVED from the assetId with
 *   exactly the client asset-label rule - only the two native ids this
 *   product records map to chain symbols and their real decimals; anything
 *   else falls back to its own identifier (never an invented symbol).
 *   decimals is never used on this path: amounts are stored normalized and
 *   USD values are exact amount x price via mulDecimal (6dp truncation,
 *   matching units.valueUsd). Unpriced rows keep valueUsd=null, never '0'.
 */
import type { ChallengeDb } from '../auth/challenges';
import { addDecimal, mulDecimal, PRICE_MAX_SKEW_MS, type AssetRef, type Network, type Position, type PositionKind, type PricePoint } from './domain';
import { attributedCompleteRuns, hasNewerUnattributed, newestAttributedPartialAt } from './run-baselines';

const NETWORKS: Network[] = ['ethereum', 'solana'];

/** Read-path asset label/decimals derived from the assetId - never invents. */
export function assetRefFromId(assetId: string): AssetRef {
  const slash = assetId.indexOf('/');
  if (slash < 0) return { assetId, symbol: assetId, decimals: 0 };
  const net = assetId.slice(0, slash);
  const rest = assetId.slice(slash + 1);
  if (rest === 'native') {
    if (net === 'eip155:1') return { assetId, symbol: 'ETH', decimals: 18 };
    if (net === 'solana' || net.startsWith('solana:')) return { assetId, symbol: 'SOL', decimals: 9 };
    return { assetId, symbol: 'NATIVE', decimals: 0 };
  }
  const m = /^erc20:(.+)$/.exec(rest);
  if (m) {
    const c = m[1]!;
    if (/^0x[0-9a-fA-F]{40}$/.test(c)) return { assetId, symbol: `${c.slice(0, 6)}…${c.slice(-4)}`, decimals: 0 };
    return { assetId, symbol: c, decimals: 0 };
  }
  const colon = rest.lastIndexOf(':');
  return { assetId, symbol: colon >= 0 ? rest.slice(colon + 1) : rest, decimals: 0 };
}

export type PositionHistory = {
  /** Newest per-network baseline instant (max), null when no attributed
   *  complete run exists anywhere. */
  latestObservedAt: string | null;
  /** TRUE when an ATTRIBUTED partial run (including a new-era row-less one)
   *  is NEWER (wall-clock) than the newest complete baseline, or when only
   *  partial history exists (amendment A2). */
  newerPartial: boolean;
  /** TRUE when a LEGACY (NULL-network) row-less non-error run is newer than
   *  the newest complete baseline: a newer sync whose network coverage was
   *  never recorded (amendment A2 - legacy runs only). */
  newerUnattributed: boolean;
  /** TRUE when at least one attributed COMPLETE run exists on any network -
   *  distinguishes "recorded, nothing held" from "never observed". */
  anyBaseline: boolean;
  /** Holdings at the per-network baseline runs (balances + positions). */
  positions: Position[];
  /** Recorded-RUN membership of the served baselines: 'exact' = every serving
   *  run is post-fix (run-scoped rows); 'best_effort_legacy' = a legacy
   *  baseline may UNDER-SERVE (never phantom holdings). Says NOTHING about
   *  portfolio completeness, valuation or provider truth. */
  recordedRunMembership: 'exact' | 'best_effort_legacy';
  /** Per-network baseline instants - the honest per-network label. */
  networks: { network: Network; latestObservedAt: string }[];
};

type BalanceRow = {
  assetId: string;
  address: string;
  amount: string;
  observedAt: string;
  provider: string;
  priceUsd: string | null;
  priceSource: string | null;
  priceObservedAt: string | null;
};
type PositionRow = {
  protocol: string;
  position: string;
  address: string;
  observedAt: string;
  provider: string;
  priceUsd: string | null;
  priceSource: string | null;
  priceObservedAt: string | null;
};

const priceOf = (r: { priceUsd: string | null; priceSource: string | null; priceObservedAt: string | null; observedAt: string }): PricePoint | null =>
  r.priceUsd === null
    ? null
    : { usd: r.priceUsd, source: r.priceSource ?? 'recorded', observedAt: r.priceObservedAt ?? r.observedAt };

/** The single recorded quote for one (run, asset): the most recently observed
 *  recorded quote, deterministic MAX(id) tiebreak (reviewer R1 fix). */
const PRICE_LATEST = (runCol: string, assetExpr: string) =>
  `LEFT JOIN price_observations po ON po.id = (
     SELECT p2.id FROM price_observations p2
      WHERE p2.sync_run_id = ${runCol} AND p2.asset_id = ${assetExpr}
      ORDER BY p2.price_observed_at DESC, p2.id DESC LIMIT 1)`;

export async function loadRecordedPositions(db: ChallengeDb, userId: string): Promise<PositionHistory> {
  const positions: Position[] = [];
  const networks: { network: Network; latestObservedAt: string }[] = [];
  let maxBaselineRequestedAt: string | null = null;
  let anyLegacyServing = false;

  for (const network of NETWORKS) {
    const runs = await attributedCompleteRuns(db, userId, network);
    if (runs.length === 0) continue;
    const baseline = runs[0];
    if (baseline.legacy) anyLegacyServing = true;
    networks.push({ network, latestObservedAt: baseline.instant });
    if (maxBaselineRequestedAt === null || baseline.requestedAt > maxBaselineRequestedAt)
      maxBaselineRequestedAt = baseline.requestedAt;

    // STRICT run membership: exactly this run's rows on this network.
    const balances = await db
      .prepare(
        `SELECT bs.asset_id AS assetId, bs.address AS address, bs.amount AS amount,
                bs.observed_at AS observedAt, sr.provider AS provider,
                po.usd AS priceUsd, po.source AS priceSource, po.price_observed_at AS priceObservedAt
           FROM balance_snapshots bs
           JOIN portfolios pf ON pf.id = bs.portfolio_id
           JOIN sync_runs sr ON sr.id = bs.sync_run_id
           ${PRICE_LATEST('bs.sync_run_id', 'bs.asset_id')}
          WHERE pf.user_id = ? AND bs.sync_run_id = ? AND bs.network = ?
          ORDER BY bs.asset_id`,
      )
      .bind(userId, baseline.id, network)
      .all<BalanceRow>();
    for (const r of balances.results) {
      const price = priceOf(r);
      positions.push({
        kind: 'wallet_balance',
        asset: assetRefFromId(r.assetId),
        network,
        address: r.address,
        amount: r.amount,
        price,
        valueUsd: price ? mulDecimal(r.amount, price.usd) : null,
        source: r.provider,
        observedAt: r.observedAt,
        protocol: null,
      });
    }

    const rows = await db
      .prepare(
        `SELECT ps.protocol AS protocol, ps.position AS position,
                ps.address AS address, ps.observed_at AS observedAt, sr.provider AS provider,
                po.usd AS priceUsd, po.source AS priceSource, po.price_observed_at AS priceObservedAt
           FROM position_snapshots ps
           JOIN portfolios pf ON pf.id = ps.portfolio_id
           JOIN sync_runs sr ON sr.id = ps.sync_run_id
           ${PRICE_LATEST('ps.sync_run_id', `json_extract(ps.position, '$.asset.assetId')`)}
          WHERE pf.user_id = ? AND ps.sync_run_id = ? AND ps.network = ?
          ORDER BY ps.protocol`,
      )
      .bind(userId, baseline.id, network)
      .all<PositionRow>();
    for (const r of rows.results) {
      // Fail-closed: a corrupt recorded row throws; the handler answers
      // storage_unavailable rather than present fabricated or partial figures.
      const body = JSON.parse(r.position) as {
        kind: PositionKind;
        asset: AssetRef;
        amount: string;
        valueUsd: string | null;
      };
      positions.push({
        kind: body.kind,
        asset: body.asset,
        network,
        address: r.address,
        amount: body.amount,
        price: priceOf(r),
        valueUsd: body.valueUsd,
        source: r.provider,
        observedAt: r.observedAt,
        protocol: r.protocol,
      });
    }
  }

  const latestObservedAt =
    networks.length === 0 ? null : networks.map((n) => n.latestObservedAt).sort().reverse()[0];

  const partialAt = await newestAttributedPartialAt(db, userId);
  const newerPartial =
    partialAt !== null && (maxBaselineRequestedAt === null || partialAt > maxBaselineRequestedAt);
  const newerUnattributed = await hasNewerUnattributed(db, userId, maxBaselineRequestedAt);

  return {
    latestObservedAt,
    newerPartial,
    newerUnattributed,
    anyBaseline: networks.length > 0,
    positions,
    networks,
    recordedRunMembership: anyLegacyServing ? 'best_effort_legacy' : 'exact',
  };
}

/* ---------- Slice 3 (plan 6.1): per-run history series ---------- */

/** One ACTUAL recorded observation on the time axis (reviewer A1/PIN3):
 *  every point is one real attributed COMPLETE run - never a derived or
 *  carried-forward value. Points key by RUN ID, never by instant: multiple
 *  runs sharing an observedAt all persist as distinct points. */
export type RunSeriesPoint = {
  runId: string;
  /** Wall-clock request time - ordering tiebreak within same-instant ties
   *  (approved A1 ordering); NOT the chart axis. */
  requestedAt: string;
  /** The run's observation instant - the chart x value (A4). */
  observedAt: string;
  /** Priced subtotal of the run's ASSET rows (spot + supplied) under the
   *  same fresh-price convention as the headline: rows whose recorded quote
   *  is stale relative to the run's own observation are excluded and counted;
   *  DEBT rows never enter the series (A3). A complete ZERO-ROW run plots
   *  '0' - an actual recorded "nothing held", never a resurrection. */
  pricedSubtotalUsd: string;
  unpricedCount: number;
  staleCount: number;
  /** Legacy-era run: per-run membership is best-effort (may under-serve);
   *  flagged on the point, never silently mixed (A1). */
  legacy: boolean;
};

/** Per-network actual-run series for the Overview history chart. Chronological
 *  order (requested_at ASC, id ASC within a tie - PIN3: within a same-instant
 *  tie the LATER run in the approved order is the network's value going
 *  forward, so a same-instant zero-row removal is never hidden). */
export async function loadRunSeries(
  db: ChallengeDb,
  userId: string,
): Promise<{ network: Network; points: RunSeriesPoint[] }[]> {
  const out: { network: Network; points: RunSeriesPoint[] }[] = [];
  for (const network of NETWORKS) {
    const runs = await attributedCompleteRuns(db, userId, network);
    const points: RunSeriesPoint[] = [];
    // runs arrive newest-first; series are chronological.
    for (const run of [...runs].reverse()) {
      const balances = await db
        .prepare(
          `SELECT bs.amount AS amount, bs.observed_at AS observedAt,
                  po.usd AS priceUsd, po.price_observed_at AS priceObservedAt
             FROM balance_snapshots bs
             JOIN portfolios pf ON pf.id = bs.portfolio_id
             ${PRICE_LATEST('bs.sync_run_id', 'bs.asset_id')}
            WHERE pf.user_id = ? AND bs.sync_run_id = ? AND bs.network = ?`,
        )
        .bind(userId, run.id, network)
        .all<{ amount: string; observedAt: string; priceUsd: string | null; priceObservedAt: string | null }>();
      const rows = await db
        .prepare(
          `SELECT ps.position AS position, ps.observed_at AS observedAt,
                  po.usd AS priceUsd, po.price_observed_at AS priceObservedAt
             FROM position_snapshots ps
             JOIN portfolios pf ON pf.id = ps.portfolio_id
             ${PRICE_LATEST('ps.sync_run_id', `json_extract(ps.position, '$.asset.assetId')`)}
            WHERE pf.user_id = ? AND ps.sync_run_id = ? AND ps.network = ?`,
        )
        .bind(userId, run.id, network)
        .all<{ position: string; observedAt: string; priceUsd: string | null; priceObservedAt: string | null }>();
      let subtotal = '0';
      let unpriced = 0;
      let stale = 0;
      for (const r of balances.results) {
        if (r.priceUsd === null) { unpriced += 1; continue; }
        const value = mulDecimal(r.amount, r.priceUsd);
        if ((Date.parse(r.observedAt) - Date.parse(r.priceObservedAt ?? r.observedAt)) > PRICE_MAX_SKEW_MS) { stale += 1; continue; }
        subtotal = addDecimal(subtotal, value);
      }
      for (const r of rows.results) {
        const body = JSON.parse(r.position) as { kind: PositionKind; valueUsd: string | null; observedAt?: string };
        if (body.kind === 'protocol_debt') continue; // A3: debt never in the series
        if (body.valueUsd === null) { unpriced += 1; continue; }
        if ((Date.parse(r.observedAt) - Date.parse(r.priceObservedAt ?? r.observedAt)) > PRICE_MAX_SKEW_MS) { stale += 1; continue; }
        subtotal = addDecimal(subtotal, body.valueUsd);
      }
      points.push({
        runId: run.id,
        requestedAt: run.requestedAt,
        observedAt: run.instant,
        pricedSubtotalUsd: subtotal,
        unpricedCount: unpriced,
        staleCount: stale,
        legacy: run.legacy,
      });
    }
    if (points.length > 0) out.push({ network, points });
  }
  return out;
}
