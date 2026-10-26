# Account-data claiming: Access-era rows to native accounts (B.3) - REVISED DRAFT v4

Status: DESIGN DRAFT for independent whole-head review, 2026-10-26 v4
(supersedes b4900e6 v3, which the reviewer assessed 02:10 as NOT APPROVED
with the minimal-protocol ruling applied here). No implementation, route
activation, real-data re-keying, or production access is authorized.
Synthetic staging rehearsal only, after review. The SQL-shaped construction
in section 5 remains REVIEW INPUT, not an approved algorithm; the D1 proof
obligations in section 7 must be discharged on actual D1 before any code.
This document is design evidence that the security review is catching real
defects BEFORE real data - it is not a claim-migration-ready artifact.

Plan sources: Phase B.3, plan line 78 (no silent Cloudflare-identity-to-Sola
-user assumption; preserve only after secure proof of continuity), section 11
(rehearsed on staging, rollback documented).

## 1. Data model (source of truth: migrations/)

Legacy (Access era, 0001): `tracked_addresses(owner_issuer_subject, network,
address, label, created_at, updated_at)`, PK (owner_issuer_subject, network,
address). Owner key = Access `iss` + `sub`. The only Access-era USER table;
`rate_counters` is operational and never claimed.

Native (0002/0003): `users`, `auth_identities`, `sessions`; `portfolios`
UNIQUE(user_id); `portfolio_addresses(portfolio_id, network, address, label,
verification, created_at, removed_at)`, PK (portfolio_id, network, address).
Per-network cap is 5 in BOTH stores (reviewer-verified parity), label CHECK
1-40 in both, network CHECK identical, ETH addresses stored lowercase in both
(verbatim copy is case-safe).

New claim tables (proposed, migration 0004 - not written):
- `claims_ledger(id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, user_id TEXT
  NOT NULL, state TEXT NOT NULL CHECK(state IN ('claimed','rolled_back')),
  created_at TEXT NOT NULL, rolled_back_at TEXT)` with
  `CREATE UNIQUE INDEX claims_one_active ON claims_ledger(owner_key)
   WHERE state='claimed'` (partial unique index - see section 7; reviewer
  RULED reclaim allowed).
- `claim_before_images(ledger_id, network, address, label, created_at,
  updated_at, PRIMARY KEY(ledger_id, network, address))` - verbatim legacy
  copy INCLUDING `updated_at` (which the native schema drops).
- `claims_ledger_rows(ledger_id, network, address, disposition
  CHECK(disposition IN ('copied','skipped_live_dup','skipped_tombstone_dup')),
  PRIMARY KEY(ledger_id, network, address))` - exact per-row provenance,
  DISPOSITION ONLY. V3's per-row state column and all residue_hold machinery
  are REMOVED (reviewer 02:10 headline ruling, section 4).

## 2. Continuity and threat model (unchanged, reviewer-verified)

Binding: claim request must carry an Access assertion validated AT CLAIM TIME
by the existing verifier (`checkAccessJwt`: jose RS256 signature, exp/nbf,
iss=https://teamDomain, aud, required exp, key fetch fails closed past 6h
staleness) whose validated `iss`+`sub` equals the legacy owner key
byte-for-byte. Email is a display hint, never the binding; the plan forbids
email-text merging. Rotation (org re-add -> new sub) fails equality -> orphan,
owner-manual only. Forgery rejected by signature/iss/aud; replay by exp/nbf +
one-shot ledger. Claim is EXPLICITLY user-initiated from a signed-in native,
entitled session, with the same strict Origin/CSRF checks as existing auth
POSTs and per-user rate limits. There is NO auto-claim at sign-in or anywhere.

Endpoint scoping (reviewer B5, 02:10): the claim-report and rollback
endpoints SCOPE BY SESSION user_id - a request only ever acts on a
claims_ledger row whose user_id equals the session's user. A guessed attempt
id from another user is rejected, not merely unlikely to collide.

## 3. Required invariants (review gate, unchanged)

I1 never expose mixed ownership; I2 never restore over a concurrent legitimate
update; I3 defined recovery after a crash at every boundary, converging to
claim-absent OR claim-complete, never both.

I1 SCOPE (reviewer 02:10 ruling): I1 constrains claim-system TRANSITION
instants - the forward batch and the rollback batch, both atomic, no mixed
instant inside either. The pre-claim both-surfaces baseline (legacy row and
an independent pre-existing native twin both visible) is the accepted status
quo ante that the claim exists to end; returning to it WITH per-row
disclosure on rollback is not an I1 violation.

## 4. Reviewer rulings applied (2026-10-26 02:04-02:10)

- Protocol: CANDIDATE A (single guarded batch). Candidate B (two-batch +
  compensating restore) is NOT approved as the protocol - its inter-batch
  crash windows can strand or misrestore ownership. Candidate C (copy-then-
  hide visibility flip) rejected: read-path exposure risk and no atomic flip
  across row sets. (B's complete-forward shape survives ONLY as the explicitly
  unproven contingency in section 7 if D2 fails on actual D1 - never
  pre-approved.)
- Concurrent legacy writes: FREEZE-WRITES-ON-CLAIM-START as an IN-STATEMENT
  guard on the legacy write paths (add/remove/clear):
  `AND NOT EXISTS(SELECT 1 FROM claims_ledger WHERE owner_key=? AND
  state='claimed')`. The legacy add is already one atomic INSERT...SELECT
  (server/accounts/d1.ts:77-81), so the guard serializes writes against the
  claim at the database. Claim-window UX is product polish, not a control.
- Reviewer's naive repeated-NOT-EXISTS guards and its own first "no
  self-reference" simplification were WITHDRAWN (02:05-02:06) after main
  showed self-invalidation under read-your-writes.
- RESIDUE-HOLD REJECTED (02:10, headline ruling). V3's per-row residue_hold
  machinery (state column, per-row legacy-visibility joins, hold-clear
  triggers, expiry policy, sweep questions) is unnecessary policy complexity
  with two real defects: (a) it converted PRE-EXISTING claim-time duplicates
  into claim-system residue the system would then "own" resolving, though the
  duplication predates the claim system; (b) its hold-clear ("on-write check
  or sweep") was automatic silent re-exposure - a hidden legacy row flipping
  back visible without user awareness. Both defects vanish under the minimal
  protocol in section 6. V3 open questions 2 and 3 are moot.
- Rollback fail-closed ORDERING (main 02:10): an offending live edit must
  cause the ENTIRE rollback batch to no-op BEFORE any native cleanup or
  state flip - never detect-after-deletion. The section 6 construction
  achieves this by gating every rollback statement on the same NOT EXISTS
  offender predicate, so a present offender no-ops the deletes AND the flip
  in the same atomic batch.

## 5. The S1-S4 single-batch construction (review input; exact order matters)

ATT = fresh attempt id, K = validated legacy owner key, P = claimant
portfolio, U = claimant user (session user). One D1 batch, four statements:

  S1 ledger: INSERT INTO claims_ledger(id, owner_key, user_id, state,
    created_at) SELECT ATT, K, U, 'claimed', now
    WHERE EXISTS(SELECT 1 FROM tracked_addresses WHERE owner_issuer_subject=K)
      AND NOT EXISTS(SELECT 1 FROM claims_ledger WHERE owner_key=K
                     AND state='claimed')
      AND (per network n: nativeLive(P,n) + |legacy(K,n)|
           - |legacy(K,n) whose PK exists in portfolio_addresses(P,n) at ANY
             removed_at state| <= 5)
    -- S1 carries ALL raw guards and no self-reference; it runs first, so its
    -- reads see only committed pre-claim state. The partial unique index is
    -- the atomic arbiter for racing claims: the loser violates it and the
    -- whole batch aborts.

  S2 before-image: INSERT INTO claim_before_images SELECT ATT, network,
    address, label, created_at, updated_at FROM tracked_addresses
    WHERE owner_issuer_subject=K
      AND EXISTS(SELECT 1 FROM claims_ledger WHERE id=ATT)
    -- attempt-specific gate: NOT "any ledger row", THIS attempt.

  S3 provenance (MUST precede S4): INSERT INTO claims_ledger_rows
    SELECT ATT, t.network, t.address, CASE WHEN p.address IS NULL THEN 'copied'
      WHEN p.removed_at IS NULL THEN 'skipped_live_dup'
      ELSE 'skipped_tombstone_dup' END
    FROM tracked_addresses t LEFT JOIN portfolio_addresses p
      ON p.portfolio_id=P AND p.network=t.network AND p.address=t.address
    WHERE t.owner_issuer_subject=K
      AND EXISTS(SELECT 1 FROM claims_ledger WHERE id=ATT)
    -- Evaluated on the pre-copy snapshot: own writes so far touch only
    -- claims_ledger/claim_before_images, so the join cannot see S4's rows.
    -- The 'copied' predicate equals S4's filter by construction.

  S4 copy: INSERT INTO portfolio_addresses(portfolio_id, network, address,
    label, verification, created_at) SELECT P, network, address, label,
    'watched', created_at FROM tracked_addresses
    WHERE owner_issuer_subject=K
      AND EXISTS(SELECT 1 FROM claims_ledger WHERE id=ATT)
      AND NOT EXISTS(SELECT 1 FROM portfolio_addresses p
        WHERE p.portfolio_id=P AND p.network=network AND p.address=address)
    -- NOT EXISTS is the skip mechanism; no ON CONFLICT needed within one
    -- serialized batch. Labels and created_at are verbatim; verification is
    -- always 'watched'.

Caps are evaluated ONLY in S1 (single snapshot); S2-S4 never re-evaluate them
(mid-batch count shifts were a named hazard). Legacy rows are NOT deleted and
NOT updated by the claim; hiding is derived (section 6).

Claim report: the pre-confirm PREVIEW (three enumerated sets - rows to copy,
live duplicates, tombstone duplicates) is ADVISORY and TOCTOU; the
authoritative report is the PERSISTED S3-derived provenance read back after
commit (reviewer 02:10; concurrent state can change between preview and the
batch, and the batch's own guards are the only authoritative evaluation).

Crash semantics: crash before batch commit = full rollback = claim-absent;
crash after commit = claim-complete. No intermediate states exist by
construction, which is why this candidate satisfies I3 IF D1 batch atomicity
holds - hence the proof obligations in section 7.

## 6. Visibility and rollback - the minimal protocol

Hiding is STATE-DERIVED at the OWNER-KEY level only:
- Legacy list/read paths filter `WHERE NOT EXISTS(SELECT 1 FROM claims_ledger
  WHERE owner_key=K AND state='claimed')`. A 'rolled_back' row does NOT hide.
  There are NO per-row residue joins anywhere (removed with the v3 machinery).
- Legacy write paths (add/remove/clear) carry the same state='claimed' guard
  (freeze-writes ruling).
- Native rows created by a claim are ordinary portfolio_addresses rows; their
  claim origin is recorded ONLY in claims_ledger_rows (disposition), so
  rollback can distinguish them from pre-existing native rows exactly.

Rollback (a separate, explicit, session-user-scoped, guarded batch):

  OFFENDER predicate (for attempt ATT): a claims_ledger_rows row with
  disposition='copied' whose native row is LIVE and DIVERGED:
  removed_at IS NULL AND (label != before-image label
  OR created_at != before-image created_at OR verification != 'watched').

  R1: DELETE a claim-created native row ONLY IF removed_at IS NULL AND label
      AND created_at match the before-image exactly AND verification STILL
      ='watched' - AND ONLY IF NOT EXISTS(any OFFENDER for ATT).
  R2: UPDATE claims_ledger SET state='rolled_back', rolled_back_at=now
      WHERE id=ATT AND state='claimed' AND NOT EXISTS(any OFFENDER for ATT).

  Every statement in the rollback batch carries the same NOT EXISTS(OFFENDER)
  gate, so one offending live edit no-ops the ENTIRE batch before any native
  cleanup or state flip (main 02:10). The batch outcome is read from
  per-statement meta.changes (D8); zero changes on R2 = failed closed.

  FAIL-CLOSED path: rollback aborts, names the offending rows (advisory
  read-only query, TOCTOU vs the batch's authoritative guards), states the
  remedy: the user removes or reconciles the named native rows, then retries.
  Retry succeeds because native removal tombstones them into the skip path
  below. No restore over edits (I2), no holds, no silent partial cleanup.

  SKIP path: a copied row the USER TOMBSTONED natively post-claim
  (removed_at NOT NULL) is NOT an offender and NOT deleted - the user's
  removal stands, the tombstone is preserved, the row is reported, and the
  rollback PROCEEDS. (Reviewer X2 counterexample closed: v3's match would
  have DELETED that tombstone, erasing the user's removal record.)

  VERIFICATION-UPGRADE path: a copied row the user upgraded watched->verified
  post-claim is an OFFENDER (verification != 'watched') - fail closed, never
  delete the verified row. (Reviewer X1 counterexample closed: v3's
  label+created_at match would have silently discarded the upgrade.)

  CLAIM-TIME SKIPPED DUPS (live or tombstone): NO hold. Rollback re-exposes
  the legacy twin beside a still-live native twin - exactly the pre-claim
  baseline - with the re-exposure reported per row (I1-scope ruling, §3).
  A twin the user changed since the claim needs no special handling either:
  the legacy row simply re-exposes, again restoring the pre-claim world.

B4 read-model grounding (decides hard DELETE vs removed_at-mark; reviewer
required the author state this): the history read model
(server/portfolio/history.ts) joins balance_snapshots and position_snapshots
to portfolios and sync_runs ONLY - never to portfolio_addresses; snapshot
rows carry their own denormalized (portfolio_id, network, address). No read
model depends on the continued PRESENCE of a portfolio_addresses row. The
sync WRITE path enumerates portfolio_addresses (server/portfolio/sync.ts) to
choose what to observe; a hard-deleted claim-created row simply stops being
observed, which is exactly the pre-claim world. Therefore R1 hard-DELETEs.

The before-image remains dispute/provenance evidence, not a normal-restore
source (legacy rows were retained, never deleted).

## 7. Reclaim after rollback, D1 proof obligations, D2 contingency

Reclaim: the partial unique index `claims_one_active ... WHERE
state='claimed'` permits a NEW attempt (new ATT) after a rollback; reviewer
RULED reclaim allowed. Provenance is per-attempt so attempts never confuse
rows. Rolled_back ledger rows are retained until owner-approved purge
(reviewer RULED; no limits at this scale).

Actual-D1 proof obligations (synthetic keys on staging; node:sqlite adapter
results do NOT establish D1 behavior - the local harness is preparatory
counterexample-finding ONLY and must never be cited as D1 evidence):
 D1 UNIQUE-violation aborts the WHOLE batch (nothing commits).
 D2 read-your-writes WITHIN a batch: S2/S3/S4's EXISTS(claims_ledger id=ATT)
    sees S1's uncommitted insert.
 D3 two concurrent identical claims: exactly one batch commits.
 D4 statement ordering within a batch is preserved (S3's pre-copy snapshot).
 D5 guarded legacy write during a claim attempt: rejected honestly AFTER the
    ledger commit, accepted BEFORE it (no hidden stragglers).
 D6 partial unique index (claims_one_active ... WHERE state='claimed')
    behaves as SQLite documents on actual D1: racing 'claimed' inserts
    collide, a 'rolled_back' row does not block a re-claim.
 D7 a zero-row INSERT...SELECT is a success no-op (the S1 guard-miss path
    depends on it).
 D8 per-statement meta.changes is available (honest outcome detection for
    S1==0 and the rollback R2==0 fail-closed read).

D2 CONTINGENCY - explicitly UNPROVEN, never pre-approved (reviewer B3): if D2
fails on actual D1, the fallback is a two-batch complete-forward shape:
batch one writes only the ledger reservation; batch two performs an
IDEMPOTENT copy re-run (S2-S4 equivalents re-executable with no effect if
already applied); plus a stranded-reservation detector (ledger 'claimed'
with no provenance rows after a bounded window), a NAMED recovery trigger,
and a stated maximum stranding window. This contingency is design material
for that failure branch only; it is NOT an approved protocol and does not
weaken the Candidate A commitment while D2 is unproven.

## 8. Rehearsal matrix (synthetic staging rows only, after design approval)

1. Happy path: labels/created_at verbatim, verification always 'watched',
   provenance complete, before-image includes updated_at.
2. Replayed claim (same ATT and new ATT): clean loss, honest already-claimed,
   zero partial state.
3. Concurrent claims same K: exactly one wins (D3).
4. Cap-merge reject: merged count >5 -> S1 no-op, NOTHING mutates, honest
   cap error (regression for the named guard-cascade hazard).
5. Live duplicate: native row untouched, disposition recorded, legacy hidden,
   report names it; rollback leaves the native row alone (never deletes
   pre-existing native).
6. Tombstone duplicate: never resurrected; report names it; after rollback
   the tombstone is exactly as before.
7. D1 obligations D1-D8 on actual D1 (explicitly not the adapter).
8. Crash injection around the single batch: before commit -> claim-absent;
   after commit -> claim-complete; recovery sweep finds no partial state.
9. Legacy write during claim window: frozen with honest error after ledger
   commit (D5); succeeds before it and is then included in the claim.
10. Rollback, all rows clean: full restore of the pre-claim world;
    idempotent second rollback (R2 state guard).
11. Rollback with a natively-DIVERGED copied row (relabel OR watched->
    verified upgrade): the ENTIRE rollback batch no-ops before any cleanup
    or flip (fail closed), the offending rows are named, the remedy is
    stated, and retry AFTER the user removes/reconciles them natively
    SUCCEEDS (removal tombstones them into the skip path).
12. Rollback re-exposure of claim-time duplicates: live-dup and
    tombstone-dup twins re-expose beside the native twin exactly as the
    pre-claim baseline, with the re-exposure reported per row; no holds,
    no automatic clearing machinery anywhere.
13. Reclaim after rollback with a fresh ATT (partial unique index, D6):
    succeeds with disjoint provenance; a second 'claimed' row for K is
    impossible while one is active.
14. Rollback after user-removed-native: a copied row the user tombstoned
    post-claim is SKIPPED (removal stands, tombstone preserved), reported,
    and the rollback PROCEEDS (reviewer X2).
15. Endpoint user-scoping: report/rollback endpoints reject an attempt id
    whose ledger user_id != session user_id, even when the id exists.

Local adapter status (2026-10-26, node:sqlite, NOT D1 evidence): v3-shape
cases 1-6, 8-11, 13 PASS on the adapter; reviewer independently reproduced
11/11 and used the harness to execute counterexamples X1/X2 against the v3
rollback shape. The harness is being retargeted to the v4 minimal protocol
(cases 11/12/14 rewritten, residue_hold removed); results remain adapter-only
preparatory counterexample-finding.

## 9. Environment inventory (read-only, counts/keying only, 2026-10-26)

Staging D1: entitlements=1, users=2, sessions=4, challenges=6,
tracked_addresses=0, portfolio_addresses=2 (native tombstones from earlier
reviewed exercises). ZERO Access-era user rows exist on staging - rehearsal
seeds its own synthetic keys. Production: not inspected; never test-written.

## 10. Open questions / blockers for the reviewer

1. S1-S4 and the R1/R2 offender-gated construction's soundness under actual
   D1 semantics (D1-D8) - atomicity and read-your-writes stay UNRESOLVED
   until proven; the construction is not adopted as sound on documentation
   alone. REHEARSAL-0 (the 8 D-obligations on actual D1, synthetic keys, no
   claim code) is scoped by main AFTER this doc's review - not authorized.
2. The exact OFFENDER subquery shape in R1/R2 (join form vs correlated
   EXISTS) - semantics stated above; final SQL to be confirmed in review.
3. Whether 'rolled_back' ledger rows and their provenance ever need
   owner-visible history surfacing (product question; retention ruled).
4. Claim entry surface placement (/account claim panel) - UX only, no route
   exists or is authorized.
