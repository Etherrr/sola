/**
 * Observation sync (plan: opt-in read-only snapshots; refresh-driven on
 * preview, cadence honest). POST /api/v1/portfolio/sync: the entitled user's
 * saved addresses are read LIVE from chain providers and, ONLY when snapshot
 * consent is active, recorded as immutable observations (sync_runs +
 * balance/position/price snapshots via snapshots.ts).
 *
 * Hard honesty rules:
 * - NO CONSENT, NO PROVIDER CALL: without an active consent row this endpoint
 *   does not touch chain providers at all (recording is opt-in, not the read).
 * - SIMULATED RESULTS ARE NEVER RECORDED: a provider result with
 *   simulated=true is refused even if the caller asked (no mock history).
 * - Live data off (PORTFOLIO_LIVE_DATA !== '1') -> 503, records nothing.
 * - Per-network partial failures are reported per network; one network's
 *   failure never erases or blocks another's recording.
 */
import { requireSameOrigin, requireEntitledSession } from '../auth/guards';
import { createD1Limiter } from '../accounts/d1-limiter';
import type { LimitWindow } from '../accounts/limiter';
import type { NativeAuthEnv } from '../auth/email';
import type { PortfolioProvider, ProviderResult } from './provider';
import { createLiveProvider } from './live-provider';
import { createSolanaLiveProvider } from './live-provider-solana';
import { hasSnapshotConsent, recordObservation, recordSyncError, type RecordOutcome, type SyncErrorKind } from './snapshots';

const json = (status: number, body: unknown, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

/** Sync is expensive (live RPC per network): a tight per-user durable limit
 *  AFTER the entitlement gate. */
const SYNC_WINDOWS: LimitWindow[] = [{ limit: 10, windowMs: 600_000 }];
const SYNC_TIMEOUT_MS = 25_000;

export interface SyncDeps {
  ethereum: PortfolioProvider;
  solana: PortfolioProvider;
  timeoutMs: number;
}

export const defaultSyncDeps = (): SyncDeps => ({
  ethereum: createLiveProvider(),
  solana: createSolanaLiveProvider(),
  timeoutMs: SYNC_TIMEOUT_MS,
});

export type SyncEnv = NativeAuthEnv & { PORTFOLIO_LIVE_DATA?: string };

type Network = 'ethereum' | 'solana';

type NetworkRun =
  | { network: Network; recorded: true; balances: number; positions: number; prices: number; skippedDuplicates: number; observedAt: string }
  | { network: Network; recorded: false; reason: string };

async function readNetwork(
  provider: PortfolioProvider,
  addresses: string[],
  network: Network,
  timeoutMs: number,
): Promise<Extract<ProviderResult, { ok: true }> | { error: SyncErrorKind }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const result = await provider.fetchWallets(addresses, ctl.signal, { aave: network === 'ethereum' });
    if (!result.ok) return { error: result.kind };
    if (result.simulated) return { error: 'simulated_refused' };
    return result;
  } catch {
    return { error: ctl.signal.aborted ? 'timeout' : 'provider_error' };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleSync(
  req: Request,
  env: SyncEnv,
  deps: SyncDeps = defaultSyncDeps(),
): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method !== 'POST')
    return json(405, { error: 'method_not_allowed', requestId }, { allow: 'POST' });
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  if (env.NATIVE_AUTH_ENABLED !== 'true' || !env.PORTFOLIO_ACCOUNTS_DB)
    return json(503, { error: 'unavailable', requestId });
  const db = env.PORTFOLIO_ACCOUNTS_DB;
  const identity = await requireEntitledSession(req, db);
  if (identity instanceof Response) return identity;
  const userId = identity.userId;
  const lim = await createD1Limiter(db as never, SYNC_WINDOWS, 'portfolio_sync').check(userId);
  if (!lim.allowed)
    return json(429, { error: 'rate_limited', retryAfterSec: lim.retryAfterSec, requestId });

  // Opt-in gate BEFORE any provider work: nothing to record, nothing to read.
  if (!(await hasSnapshotConsent(db, userId)))
    return json(200, { status: 'ok', recorded: false, reason: 'no_consent', requestId });

  if (env.PORTFOLIO_LIVE_DATA !== '1')
    return json(503, { error: 'live_data_off', message: 'Live chain reads are switched off on this deployment.', requestId });

  const rows = await db
    .prepare(
      `SELECT pa.network AS network, pa.address AS address
         FROM portfolio_addresses pa
         JOIN portfolios p ON p.id = pa.portfolio_id
        WHERE p.user_id = ? AND pa.removed_at IS NULL
        ORDER BY pa.created_at ASC`,
    )
    .bind(userId)
    .all<{ network: string; address: string }>();
  const byNetwork: Record<Network, string[]> = { ethereum: [], solana: [] };
  for (const r of rows.results)
    if (r.network === 'ethereum' || r.network === 'solana') byNetwork[r.network].push(r.address);
  if (byNetwork.ethereum.length + byNetwork.solana.length === 0)
    return json(200, { status: 'ok', recorded: false, reason: 'no_addresses', requestId });

  const runs: NetworkRun[] = [];
  for (const network of ['ethereum', 'solana'] as const) {
    const addresses = byNetwork[network];
    if (addresses.length === 0) continue;
    const result = await readNetwork(deps[network], addresses, network, deps.timeoutMs);
    if ('error' in result) {
      // Record the ATTEMPT as bounded operational metadata (no holdings
      // content, no provider detail) so read paths can distinguish
      // attempted-and-failed from never-attempted (reviewer amendments A3/A4).
      await recordSyncError(db, userId, network, result.error);
      runs.push({ network, recorded: false, reason: result.error });
      continue;
    }
    const outcome: RecordOutcome = await recordObservation(db, userId, network, result);
    runs.push(
      outcome.recorded
        ? {
            network,
            recorded: true,
            balances: outcome.balances,
            positions: outcome.positions,
            prices: outcome.prices,
            skippedDuplicates: outcome.skippedDuplicates,
            observedAt: result.observedAt,
          }
        : { network, recorded: false, reason: outcome.reason },
    );
  }
  return json(200, { status: 'ok', recorded: runs.some((r) => r.recorded), runs, requestId });
}
