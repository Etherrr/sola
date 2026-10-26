/**
 * Account-data claiming (plan B.3, design v4 = docs/ACCOUNT_CLAIM_DESIGN.md @ e297033).
 * MODULE DRAFT ONLY: nothing here is imported, routed, wired, or flag-gated on.
 * No route exists. Migration 0004 is a draft, unapplied. The live flag does not
 * exist yet; when it does it ships OFF. Do not wire without reviewer line-by-line
 * sign-off and a separately scoped REHEARSAL-1 against a fresh throwaway DB.
 *
 * Invariants preserved from v4 (do not weaken in review edits):
 * - S1-S4 run as ONE D1 batch() (single atomic serialized transaction; D1/D3/D6
 *   semantics rehearsal-verified on actual D1 2026-10-26).
 * - S1 raw guards: legacy rows exist for owner_key K; NOT EXISTS active claim for K;
 *   per-network merged cap <= MAX (native live + legacy - dups at ANY removed_at state).
 * - The partial unique index claims_one_active is the atomic race arbiter: even if
 *   S1's NOT EXISTS guard passes in a race, the INSERT fails and the batch aborts.
 * - S3 provenance (copied / skipped_live_dup / skipped_tombstone_dup) is written in
 *   the SAME transaction as S4's copy and is the ONLY authoritative claim report.
 * - S2/S3/S4 each carry EXISTS(claims_ledger id=attemptId state='claimed'): if the
 *   S1 arbiter no-ops (rejected claim), the rest of the batch cleanly no-ops too,
 *   instead of tripping the ledger FK. FOUND BY THE ADAPTER HARNESS (FK-enforcing
 *   sqlite): without this guard a replayed claim throws mid-batch; with it the
 *   rejection is an all-zero batch the endpoint can classify honestly.
 * - Legacy rows are NEVER deleted. Claimed legacy data is hidden from legacy reads
 *   by the visibility guard below, not by mutation.
 * - Rollback is offender-gated: R1/R2 both carry NOT EXISTS(OFFENDER); if any copied
 *   row diverged from its before-image while LIVE, the rollback fails closed and
 *   names the offenders (advisory read). R1 skips tombstoned copied rows (user
 *   removal is preserved); a zero-change R2 fails closed, it never reports success.
 * - Endpoint scoping (when wired): session user must equal claims_ledger.user_id;
 *   R2 ALSO carries `AND user_id = ?` in SQL (defense in depth, from v4 verdict).
 * Each statement binds exactly the params it references (no over-binding).
 */
import { MAX_ADDRESSES_PER_NETWORK } from '../portfolio/addresses';
import type { D1Like } from '../accounts/d1';

/** The repo's canonical D1 surface (prepare/bind/run/all/first + atomic batch). */
export type ClaimDb = D1Like;

export type ClaimParams = {
  attemptId: string;   // fresh id per attempt (uuid); also the claims_ledger PK
  ownerKey: string;    // legacy owner key K (issuer:subject)
  userId: string;      // native session user id U (from the entitled session)
  portfolioId: string; // native portfolio id P (from ensurePortfolio, called before the batch)
  now: string;         // ISO timestamp
};

/** Per-network merged-cap guard: nativeLive(P,n) + |legacy(K,n)| - |legacy(K,n)
 *  whose PK exists in portfolio_addresses(P,n) at ANY removed_at state| <= MAX.
 *  Params: ?1 = portfolioId, ?2 = ownerKey (used inside S1's wider numbering). */
const CAP_GUARD = (network: 'ethereum' | 'solana') => `
  (SELECT COUNT(*) FROM portfolio_addresses
     WHERE portfolio_id = ?4 AND network = '${network}' AND removed_at IS NULL)
  + (SELECT COUNT(*) FROM tracked_addresses
     WHERE owner_issuer_subject = ?2 AND network = '${network}')
  - (SELECT COUNT(*) FROM tracked_addresses t
     WHERE t.owner_issuer_subject = ?2 AND t.network = '${network}'
       AND EXISTS (SELECT 1 FROM portfolio_addresses d
                    WHERE d.portfolio_id = ?4 AND d.network = '${network}'
                      AND d.address = t.address))
  <= ${MAX_ADDRESSES_PER_NETWORK}`;

/**
 * S1-S4: the atomic claim batch. Statements bind only what they reference.
 */
export function buildClaimStatements(db: ClaimDb, p: ClaimParams) {
  // S1: arbiter insert. Zero rows = fail closed (reason classified advisedly after).
  // ?1 attemptId, ?2 ownerKey, ?3 userId, ?4 portfolioId, ?5 now
  const s1 = db.prepare(`
    INSERT INTO claims_ledger (id, owner_key, user_id, state, created_at)
    SELECT ?1, ?2, ?3, 'claimed', ?5
    WHERE EXISTS (SELECT 1 FROM tracked_addresses WHERE owner_issuer_subject = ?2)
      AND NOT EXISTS (SELECT 1 FROM claims_ledger
                       WHERE owner_key = ?2 AND state = 'claimed')
      AND ${CAP_GUARD('ethereum')}
      AND ${CAP_GUARD('solana')}
  `).bind(p.attemptId, p.ownerKey, p.userId, p.portfolioId, p.now);

  // S2: verbatim before-images (incl. updated_at, which native drops).
  // ?1 attemptId, ?2 ownerKey
  const s2 = db.prepare(`
    INSERT INTO claim_before_images (ledger_id, network, address, label, created_at, updated_at)
    SELECT ?1, network, address, label, created_at, updated_at
    FROM tracked_addresses
    WHERE owner_issuer_subject = ?2
      AND EXISTS (SELECT 1 FROM claims_ledger g WHERE g.id = ?1 AND g.state = 'claimed')
  `).bind(p.attemptId, p.ownerKey);

  // S3: per-row provenance, computed in the SAME transaction as the copy.
  // 'copied' <=> no portfolio_addresses row at ANY removed_at state (exactly S4's filter).
  // ?1 attemptId, ?2 portfolioId, ?3 ownerKey
  const s3 = db.prepare(`
    INSERT INTO claims_ledger_rows (ledger_id, network, address, disposition)
    SELECT ?1, t.network, t.address,
      CASE
        WHEN p.address IS NULL THEN 'copied'
        WHEN p.removed_at IS NULL THEN 'skipped_live_dup'
        ELSE 'skipped_tombstone_dup'
      END
    FROM tracked_addresses t
    LEFT JOIN portfolio_addresses p
      ON p.portfolio_id = ?2 AND p.network = t.network AND p.address = t.address
    WHERE t.owner_issuer_subject = ?3
      AND EXISTS (SELECT 1 FROM claims_ledger g WHERE g.id = ?1 AND g.state = 'claimed')
  `).bind(p.attemptId, p.portfolioId, p.ownerKey);

  // S4: the copy. Verbatim label/created_at; verification ALWAYS 'watched'
  // (claiming conveys no ownership proof); live dup AND tombstone dup both skipped.
  // ?1 portfolioId, ?2 ownerKey, ?3 attemptId (arbiter guard)
  const s4 = db.prepare(`
    INSERT INTO portfolio_addresses (portfolio_id, network, address, label, verification, created_at, removed_at)
    SELECT ?1, t.network, t.address, t.label, 'watched', t.created_at, NULL
    FROM tracked_addresses t
    WHERE t.owner_issuer_subject = ?2
      AND NOT EXISTS (SELECT 1 FROM portfolio_addresses d
                       WHERE d.portfolio_id = ?1 AND d.network = t.network
                         AND d.address = t.address)
      AND EXISTS (SELECT 1 FROM claims_ledger g WHERE g.id = ?3 AND g.state = 'claimed')
  `).bind(p.portfolioId, p.ownerKey, p.attemptId);

  return [s1, s2, s3, s4];
}

/**
 * The authoritative claim report: read back PERSISTED provenance (S3), never
 * recomputed. Scoped to the session user via the ledger join.
 */
export async function readClaimReport(db: ClaimDb, attemptId: string, sessionUserId: string) {
  const { results } = await db.prepare(`
    SELECT r.network, r.address, r.disposition
    FROM claims_ledger_rows r
    JOIN claims_ledger l ON l.id = r.ledger_id
    WHERE r.ledger_id = ?1 AND l.user_id = ?2
    ORDER BY r.network, r.address
  `).bind(attemptId, sessionUserId).all<{ network: string; address: string; disposition: string }>();
  return results;
}

/**
 * OFFENDER(ATT): a copied row that is LIVE and diverged from its before-image.
 * Join form per design section 6; open question 2 (join vs correlated EXISTS)
 * is flagged for the reviewer - semantics identical, planner preference TBD.
 * Parameter slots are supplied by the caller's statement numbering.
 */
const OFFENDER_EXISTS = (ledgerSlot: number, portfolioSlot: number) => `
  EXISTS (SELECT 1 FROM claims_ledger_rows r
          JOIN portfolio_addresses p
            ON p.portfolio_id = ?${portfolioSlot} AND p.network = r.network AND p.address = r.address
          JOIN claim_before_images b
            ON b.ledger_id = r.ledger_id AND b.network = r.network AND b.address = r.address
          WHERE r.ledger_id = ?${ledgerSlot} AND r.disposition = 'copied'
            AND p.removed_at IS NULL
            AND (p.label != b.label OR p.created_at != b.created_at
                 OR p.verification != 'watched'))`;

/** Advisory offender naming for the fail-closed report. TOCTOU: read AFTER the
 *  gated batch fails, may not match the exact gate state; identity only, never
 *  a diff of user data beyond what the user already sees. */
export async function readOffenders(db: ClaimDb, attemptId: string, portfolioId: string) {
  const { results } = await db.prepare(`
    SELECT r.network, r.address
    FROM claims_ledger_rows r
    JOIN portfolio_addresses p
      ON p.portfolio_id = ?2 AND p.network = r.network AND p.address = r.address
    JOIN claim_before_images b
      ON b.ledger_id = r.ledger_id AND b.network = r.network AND b.address = r.address
    WHERE r.ledger_id = ?1 AND r.disposition = 'copied'
      AND p.removed_at IS NULL
      AND (p.label != b.label OR p.created_at != b.created_at
           OR p.verification != 'watched')
    ORDER BY r.network, r.address
  `).bind(attemptId, portfolioId).all<{ network: string; address: string }>();
  return results;
}

/**
 * R1/R2: offender-gated rollback batch. R2's `AND user_id = ?3` is the
 * session-scoping SQL defense carried from the v4 verdict - do not drop it.
 * A zero-change R2 means the rollback FAILED CLOSED (offender exists, wrong
 * user, or state moved); report failure, never success.
 */
export function buildRollbackStatements(db: ClaimDb, p: ClaimParams) {
  // R1: delete only claim-created rows still LIVE and byte-identical to their
  // before-image. Tombstoned copied rows are SKIPPED (user removal preserved,
  // rehearsal case 14/X2). Whole statement gated on NOT EXISTS(OFFENDER).
  // ?1 portfolioId, ?2 attemptId
  const r1 = db.prepare(`
    DELETE FROM portfolio_addresses
    WHERE portfolio_id = ?1
      AND removed_at IS NULL
      AND verification = 'watched'
      AND EXISTS (SELECT 1 FROM claims_ledger_rows r
                   WHERE r.ledger_id = ?2 AND r.disposition = 'copied'
                     AND r.network = portfolio_addresses.network
                     AND r.address = portfolio_addresses.address)
      AND EXISTS (SELECT 1 FROM claim_before_images b
                   WHERE b.ledger_id = ?2
                     AND b.network = portfolio_addresses.network
                     AND b.address = portfolio_addresses.address
                     AND b.label = portfolio_addresses.label
                     AND b.created_at = portfolio_addresses.created_at)
      AND NOT ${OFFENDER_EXISTS(2, 1)}
  `).bind(p.portfolioId, p.attemptId);

  // R2: flip only if still claimed, owned by the session user, no offender.
  // ?1 now, ?2 attemptId, ?3 sessionUserId, ?4 portfolioId
  const r2 = db.prepare(`
    UPDATE claims_ledger
    SET state = 'rolled_back', rolled_back_at = ?1
    WHERE id = ?2 AND state = 'claimed' AND user_id = ?3
      AND NOT ${OFFENDER_EXISTS(2, 4)}
  `).bind(p.now, p.attemptId, p.userId, p.portfolioId);

  return [r1, r2];
}

/**
 * Visibility guard for LEGACY read paths (history/refresh/aggregation), to be
 * wired by their owners later - NOT applied anywhere from this module.
 * A claimed owner_key's legacy rows are hidden from legacy reads; the data
 * itself is retained forever (unclaimed reads unaffected; rolled-back reads
 * re-expose the original rows).
 */
export const LEGACY_VISIBILITY_GUARD_SQL = `
  AND NOT EXISTS (SELECT 1 FROM claims_ledger c
                   WHERE c.owner_key = tracked_addresses.owner_issuer_subject
                     AND c.state = 'claimed')`;

/** Attempt outcome classification. S1's change count is the verdict; the
 *  reasons below are advisory post-hoc reads (TOCTOU) for an honest 409. */
export type ClaimOutcome =
  | { ok: true; attemptId: string }
  | { ok: false; reason: 'already_claimed' | 'cap_exceeded' | 'no_legacy_rows' | 'unknown' };
