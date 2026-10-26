/**
 * Claim endpoints (plan B.3, design v4 = docs/ACCOUNT_CLAIM_DESIGN.md @ e297033).
 * REACHABILITY: functions/api/v1/claim/* mounts are DEPLOYED in 79ececa, flag-gated
 * (CLAIM_ENABLED absent/OFF everywhere). The deployment-order hard gate stands: nothing ships before
 * migration 0004 is applied AND verified on the target database AND the isolated
 * rehearsal of this exact code passes on fresh disposable D1. CLAIM_ENABLED ships
 * absent/OFF on every environment; with it absent the routing layer 503s BEFORE
 * any handler or database work (tests/claim-mounts.test.ts), and the handler gate
 * below repeats the same check as defense in depth, via the shared predicate.
 *
 * Design bindings preserved here:
 * - The claim request carries a Cloudflare Access assertion (cf-access-jwt-assertion)
 *   validated AT CLAIM TIME by the existing checkAccessJwt (RS256, exp/nbf, iss, aud,
 *   key-fetch fails closed); validated iss+sub is the legacy owner key K byte-for-byte
 *   (via readOwnerKey). Email is never the binding.
 * - Session gate: requireEntitledSession + requireSameOrigin on POSTs, per-user rate
 *   limits after the entitlement gate (unauthenticated traffic 401s without quota).
 * - Preview is ADVISORY/TOCTOU; the authoritative report is the persisted S3
 *   provenance read back after the batch commits.
 * - Report/rollback scope by SESSION user_id (reviewer B5): a guessed foreign
 *   attempt id is indistinguishable from unknown (404), never an existence oracle.
 *
 * Security invariants beyond v4's text:
 *  - Claim mutations require a FRESH session (SENSITIVE_REAUTH_MS, the same
 *    pattern as passkey registration): claim moves a person's address data
 *    across identity spaces, so an old session cannot start it. A stale
 *    session gets 403 reauth_required.
 *  - Rate windows below are placeholders.
 *  - no_legacy_rows is answered 409 (not 404) so the UI can render the empty state.
 */
import { checkAccessJwt, isValidTeamHost, type KeyFetcher } from '../portfolio/access';
import { readOwnerKey } from '../accounts/handler';
import { requireSameOrigin, requireEntitledSession, type NativeIdentity } from '../auth/guards';
import { recentlyAuthenticated } from '../auth/sessions';
import type { NativeAuthEnv } from '../auth/email';
import { createD1Limiter } from '../accounts/d1-limiter';
import type { LimitWindow } from '../accounts/limiter';
import { ensurePortfolio } from '../portfolio/addresses';
import {
  buildClaimStatements,
  buildRollbackStatements,
  readClaimReport,
  readOffenders,
  type ClaimDb,
} from './claim';

export type ClaimEnv = Omit<NativeAuthEnv, 'PORTFOLIO_ACCOUNTS_DB'> & {
  /** The D1 binding (ChallengeDb-compatible, plus atomic batch). */
  PORTFOLIO_ACCOUNTS_DB?: ClaimDb;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  CLAIM_ENABLED?: string; // ships OFF; must be exactly '1'
};
export type ClaimDeps = {
  fetchKeys: KeyFetcher;
  now: () => Date;
  id: () => string;
};

const CLAIM_READ_WINDOWS: LimitWindow[] = [{ limit: 60, windowMs: 600_000 }]; // D-b placeholder
const CLAIM_WRITE_WINDOWS: LimitWindow[] = [{ limit: 10, windowMs: 600_000 }]; // D-b placeholder

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
};
const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const err = (status: number, code: string, requestId: string) =>
  json(status, { error: { code }, requestId });

const lastClaimLog = new Map<string, number>();
/** Throttled safe logging (house pattern: portfolio/handler.ts logOnce): fixed
 *  category + requestId + error NAME only, at most one line per category per
 *  minute per isolate. NEVER identities, owner keys, assertions, SQL text, or
 *  error messages. */
function logClaimFailure(category: string, requestId: string, e: unknown) {
  const now = Date.now();
  const last = lastClaimLog.get(category);
  if (last !== undefined && now - last < 60_000) return;
  lastClaimLog.set(category, now);
  console.warn(JSON.stringify({ evt: category, requestId, errorName: e instanceof Error ? e.name : 'unknown' }));
}

type Gate =
  | { ok: true; db: ClaimDb; identity: NativeIdentity }
  | { ok: false; res: Response };

/**
 * The deployment flag gate - SINGLE SOURCE used by both the routing layer
 * (server/claim/mount.ts, before any handler or database work) and gate() below
 * (defense in depth). Exact match required: native auth on, claim flag exactly
 * '1', and the D1 binding present.
 */
export function claimGateOpen(env: ClaimEnv): boolean {
  return env.NATIVE_AUTH_ENABLED === 'true' && env.CLAIM_ENABLED === '1' && !!env.PORTFOLIO_ACCOUNTS_DB;
}

/** The 503 the closed flag gate answers; one wire shape for mount and handler. */
export function claimDisabled(requestId: string): Response {
  return err(503, 'disabled', requestId);
}

/** Shared gate: flag, config, entitled session. Never logs assertion or claim values. */
async function gate(
  req: Request,
  env: ClaimEnv,
  requestId: string,
): Promise<Gate> {
  if (!claimGateOpen(env)) return { ok: false, res: claimDisabled(requestId) };
  if (!env.ACCESS_TEAM_DOMAIN || !isValidTeamHost(env.ACCESS_TEAM_DOMAIN) || !env.ACCESS_AUD)
    return { ok: false, res: err(503, 'not_configured', requestId) };
  // claimGateOpen above guarantees the binding is present.
  const db = env.PORTFOLIO_ACCOUNTS_DB!;
  const identity = await requireEntitledSession(req, db);
  if (identity instanceof Response) return { ok: false, res: identity };
  return { ok: true, db, identity };
}

async function rateLimit(
  db: ClaimDb,
  scope: 'claim_read' | 'claim_write',
  windows: LimitWindow[],
  userId: string,
  requestId: string,
): Promise<Response | null> {
  const lim = await createD1Limiter(db as never, windows, scope).check(userId); // ChallengeDb-compatible
  return lim.allowed
    ? null
    : err(429, 'rate_limited', requestId);
}

/** Validates the Access assertion at request time; returns K or a 401. Never logs the token. */
async function ownerKeyOr401(
  req: Request,
  env: ClaimEnv,
  deps: ClaimDeps,
  requestId: string,
): Promise<{ K: string } | { res: Response }> {
  const reason = await checkAccessJwt(
    req.headers.get('cf-access-jwt-assertion'),
    { teamDomain: env.ACCESS_TEAM_DOMAIN!, aud: env.ACCESS_AUD! },
    deps.fetchKeys,
    Math.floor(deps.now().getTime() / 1000),
  );
  if (reason) return { res: err(401, 'assertion_invalid', requestId) };
  const K = readOwnerKey(req.headers.get('cf-access-jwt-assertion'));
  if (!K) return { res: err(401, 'assertion_invalid', requestId) };
  return { K };
}

const DISPOSITION_SETS = `
  SELECT t.network, t.address, t.label,
    CASE
      WHEN p.address IS NULL THEN 'copy'
      WHEN p.removed_at IS NULL THEN 'live_duplicate'
      ELSE 'tombstone_duplicate'
    END AS set_name
  FROM tracked_addresses t
  LEFT JOIN portfolio_addresses p
    ON p.portfolio_id = ?2 AND p.network = t.network AND p.address = t.address
  WHERE t.owner_issuer_subject = ?1
  ORDER BY t.network, t.address`;

/** Advisory per-network merged counts (TOCTOU; S1's in-batch guards are authoritative). */
async function mergedCounts(db: ClaimDb, K: string, portfolioId: string) {
  const out: Record<string, number> = {};
  for (const n of ['ethereum', 'solana'] as const) {
    const row = await db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM portfolio_addresses
           WHERE portfolio_id = ?1 AND network = ?2 AND removed_at IS NULL)
      + (SELECT COUNT(*) FROM tracked_addresses
           WHERE owner_issuer_subject = ?3 AND network = ?2)
      - (SELECT COUNT(*) FROM tracked_addresses t
           WHERE t.owner_issuer_subject = ?3 AND t.network = ?2
             AND EXISTS (SELECT 1 FROM portfolio_addresses d
                          WHERE d.portfolio_id = ?1 AND d.network = ?2 AND d.address = t.address))
      AS merged
    `).bind(portfolioId, n, K).all<{ merged: number }>();
    out[n] = row.results[0]?.merged ?? 0;
  }
  return out;
}

/** GET preview: ADVISORY/TOCTOU three-set enumeration. Never authoritative. */
export async function handleClaimPreview(req: Request, env: ClaimEnv, deps: ClaimDeps): Promise<Response> {
  const requestId = deps.id();
  if (req.method !== 'GET') return err(405, 'method_not_allowed', requestId);
  const g = await gate(req, env, requestId);
  if (!g.ok) return g.res;
  const rl = await rateLimit(g.db, 'claim_read', CLAIM_READ_WINDOWS, g.identity.userId, requestId);
  if (rl) return rl;
  const k = await ownerKeyOr401(req, env, deps, requestId);
  if ('res' in k) return k.res;
  // READ-ONLY (reviewer R3): a preview must not create state. If no portfolio
  // exists yet, '' matches no portfolio_id, so every legacy row enumerates as
  // 'copy' and native counts are zero - exactly the would-be claim picture.
  const pf = await g.db.prepare(`SELECT id FROM portfolios WHERE user_id = ?1`)
    .bind(g.identity.userId).all<{ id: string }>();
  const portfolioId = pf.results[0]?.id ?? '';
  const { results } = await g.db.prepare(DISPOSITION_SETS).bind(k.K, portfolioId)
    .all<{ network: string; address: string; label: string; set_name: string }>();
  const active = await g.db.prepare(
    `SELECT id, user_id FROM claims_ledger WHERE owner_key = ?1 AND state = 'claimed'`,
  ).bind(k.K).all<{ id: string; user_id: string }>();
  // R3 recovery disclosure: activeAttemptId ONLY when the active claim belongs
  // to the authenticated session user. An active claim for K owned by ANOTHER
  // user still reads alreadyClaimed (the holder of a valid K assertion may know
  // the list was claimed) but gets NO attempt id, report, or undo path (B5).
  const mine = active.results.find((r) => r.user_id === g.identity.userId);
  return json(200, {
    requestId,
    advisory: true, // TOCTOU: the batch's own guards are the only authoritative evaluation
    alreadyClaimed: active.results.length > 0,
    activeAttemptId: mine?.id ?? null,
    toCopy: results.filter((r) => r.set_name === 'copy'),
    liveDuplicates: results.filter((r) => r.set_name === 'live_duplicate'),
    tombstoneDuplicates: results.filter((r) => r.set_name === 'tombstone_duplicate'),
    mergedCount: await mergedCounts(g.db, k.K, portfolioId),
  });
}

/** POST attempt: the atomic S1-S4 batch; authoritative report read back from S3 provenance. */
export async function handleClaimAttempt(req: Request, env: ClaimEnv, deps: ClaimDeps): Promise<Response> {
  const requestId = deps.id();
  if (req.method !== 'POST') return err(405, 'method_not_allowed', requestId);
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  const g = await gate(req, env, requestId);
  if (!g.ok) return g.res;
  // Claim moves address data across identity spaces: an old session cannot start
  // it. Fresh-session re-auth, same pattern as passkey registration.
  if (!recentlyAuthenticated(g.identity.session)) return err(403, 'reauth_required', requestId);
  const rl = await rateLimit(g.db, 'claim_write', CLAIM_WRITE_WINDOWS, g.identity.userId, requestId);
  if (rl) return rl;
  const k = await ownerKeyOr401(req, env, deps, requestId);
  if ('res' in k) return k.res;
  const now = deps.now().toISOString();
  const portfolioId = await ensurePortfolio(g.db, g.identity.userId, now);

  const attemptId = crypto.randomUUID();
  try {
    const results = (await g.db.batch(
      buildClaimStatements(g.db, {
        attemptId, ownerKey: k.K, userId: g.identity.userId, portfolioId, now,
      }),
    )) as { meta?: { changes?: number } }[];
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
      // Rejected by S1's guards: whole batch cleanly no-opped (S2-S4 attempt gates).
      // Classification reads below are advisory/TOCTOU; they only pick the error code.
      try {
        const active = await g.db.prepare(
          `SELECT 1 x FROM claims_ledger WHERE owner_key = ?1 AND state = 'claimed'`,
        ).bind(k.K).all();
        if (active.results.length > 0) return err(409, 'already_claimed', requestId);
        const legacy = await g.db.prepare(
          `SELECT 1 x FROM tracked_addresses WHERE owner_issuer_subject = ?1`,
        ).bind(k.K).all();
        if (legacy.results.length === 0) return err(409, 'no_legacy_rows', requestId); // D-c
        return json(409, {
          error: { code: 'cap_exceeded' }, requestId,
          mergedCount: await mergedCounts(g.db, k.K, portfolioId),
        });
      } catch (classErr) {
        logClaimFailure('claim_classification_failed', requestId, classErr);
        return err(500, 'claim_classification_failed', requestId);
      }
    }
  } catch (batchErr) {
    // Honest failure classification (reviewer R2 + freeze fix): 409 already_claimed
    // ONLY when an active claim for K is CONFIRMED present (the unique-index
    // race-loser case, D3/D6). If that confirmation read ITSELF fails, honest 500 -
    // never a throw out of the handler, never a false 409. The underlying
    // operational failure is preserved in safe logs (no identities/secrets).
    logClaimFailure('claim_batch_failed', requestId, batchErr);
    let confirmedActive: boolean;
    try {
      const active = await g.db.prepare(
        `SELECT 1 x FROM claims_ledger WHERE owner_key = ?1 AND state = 'claimed'`,
      ).bind(k.K).all();
      confirmedActive = active.results.length > 0;
    } catch (confirmErr) {
      logClaimFailure('claim_confirm_read_failed', requestId, confirmErr);
      return err(500, 'claim_failed', requestId);
    }
    if (confirmedActive) return err(409, 'already_claimed', requestId);
    return err(500, 'claim_failed', requestId);
  }
  return json(200, {
    requestId,
    attemptId,
    report: await readClaimReport(g.db, attemptId, g.identity.userId),
  });
}

/** GET report: persisted S3 provenance + ledger state, session-scoped (B5). */
export async function handleClaimReport(
  req: Request, env: ClaimEnv, deps: ClaimDeps, attemptId: string,
): Promise<Response> {
  const requestId = deps.id();
  if (req.method !== 'GET') return err(405, 'method_not_allowed', requestId);
  const g = await gate(req, env, requestId);
  if (!g.ok) return g.res;
  const rl = await rateLimit(g.db, 'claim_read', CLAIM_READ_WINDOWS, g.identity.userId, requestId);
  if (rl) return rl;
  let led: { results: { state: string; created_at: string; rolled_back_at: string | null }[] };
  let rows: Awaited<ReturnType<typeof readClaimReport>>;
  try {
    led = await g.db.prepare(
      `SELECT state, created_at, rolled_back_at FROM claims_ledger WHERE id = ?1 AND user_id = ?2`,
    ).bind(attemptId, g.identity.userId).all<{ state: string; created_at: string; rolled_back_at: string | null }>();
    if (led.results.length === 0) return err(404, 'unknown_attempt', requestId); // B5: foreign == unknown
    rows = await readClaimReport(g.db, attemptId, g.identity.userId);
  } catch (repErr) {
    logClaimFailure('report_read_failed', requestId, repErr);
    return err(500, 'report_failed', requestId);
  }
  return json(200, {
    requestId, attemptId,
    state: led.results[0].state,
    createdAt: led.results[0].created_at,
    rolledBackAt: led.results[0].rolled_back_at,
    report: rows,
  });
}

/** POST rollback: offender-gated R1/R2 batch, session-scoped; fail closed on R2=0. */
export async function handleClaimRollback(
  req: Request, env: ClaimEnv, deps: ClaimDeps, attemptId: string,
): Promise<Response> {
  const requestId = deps.id();
  if (req.method !== 'POST') return err(405, 'method_not_allowed', requestId);
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  const g = await gate(req, env, requestId);
  if (!g.ok) return g.res;
  // Same fresh-session requirement as attempt (see above).
  if (!recentlyAuthenticated(g.identity.session)) return err(403, 'reauth_required', requestId);
  const rl = await rateLimit(g.db, 'claim_write', CLAIM_WRITE_WINDOWS, g.identity.userId, requestId);
  if (rl) return rl;
  let ledRb: { results: { owner_key: string; state: string }[] };
  try {
    ledRb = await g.db.prepare(
      `SELECT owner_key, state FROM claims_ledger WHERE id = ?1 AND user_id = ?2`,
    ).bind(attemptId, g.identity.userId).all<{ owner_key: string; state: string }>();
  } catch (ledErr) {
    logClaimFailure('rollback_ledger_read_failed', requestId, ledErr);
    return err(500, 'rollback_failed', requestId);
  }
  const led = ledRb;
  if (led.results.length === 0) return err(404, 'unknown_attempt', requestId); // B5
  if (led.results[0].state !== 'claimed') return err(409, 'already_rolled_back', requestId);
  const now = deps.now().toISOString();
  const portfolioId = await ensurePortfolio(g.db, g.identity.userId, now);
  let results: { meta?: { changes?: number } }[];
  try {
    results = (await g.db.batch(
      buildRollbackStatements(g.db, {
        attemptId, ownerKey: led.results[0].owner_key,
        userId: g.identity.userId, portfolioId, now,
      }),
    )) as { meta?: { changes?: number } }[];
  } catch (rbErr) {
    logClaimFailure('rollback_batch_failed', requestId, rbErr);
    return err(500, 'rollback_failed', requestId); // honest: no state claims on error
  }
  if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
    // FAILED CLOSED: an offender exists (or state moved). Name offenders advisedly;
    // the remedy is native reconciliation/removal, then retry (case 11 path).
    return json(409, {
      error: { code: 'rollback_blocked' }, requestId,
      offenders: await readOffenders(g.db, attemptId, portfolioId),
      remedy: 'reconcile_or_remove_listed_addresses_natively_then_retry',
    });
  }
  return json(200, {
    requestId, attemptId, state: 'rolled_back',
    report: await readClaimReport(g.db, attemptId, g.identity.userId),
    note: 'legacy_rows_re_exposed_exactly_as_pre_claim_baseline',
  });
}
