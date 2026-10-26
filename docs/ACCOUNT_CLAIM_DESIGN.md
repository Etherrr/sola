# Account-data claiming: Access-era rows to native accounts (B.3) - REVISED DRAFT v2

Status: DESIGN DRAFT for independent whole-head review, 2026-10-26 (supersedes
the 5c041a6 v1 draft). No implementation, route activation, real-data
re-keying, or production access is authorized. Synthetic staging rehearsal
only, after review. The SQL-shaped construction in section 5 is REVIEW INPUT
(reviewer 02:06), not an approved algorithm; the open questions in sections
6-8 must be resolved or explicitly carried as blockers before any code.

Plan sources: Phase B.3, plan line 78 (no silent Cloudflare-identity-to-Sola
-user assumption; preserve only after secure proof of continuity), §11
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
   WHERE state='claimed'` (partial unique index - see §7 reclaim policy).
- `claim_before_images(ledger_id, network, address, label, created_at,
  updated_at, PRIMARY KEY(ledger_id, network, address))` - verbatim legacy
  copy INCLUDING `updated_at` (which the native schema drops).
- `claims_ledger_rows(ledger_id, network, address, disposition
  CHECK(disposition IN ('copied','skipped_live_dup','skipped_tombstone_dup')),
  PRIMARY KEY(ledger_id, network, address))` - exact per-row provenance.

## 2. Continuity and threat model (unchanged from v1, reviewer-verified)

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

## 3. Required invariants (review gate, unchanged)

I1 never expose mixed ownership; I2 never restore over a concurrent legitimate
update; I3 defined recovery after a crash at every boundary, converging to
claim-absent OR claim-complete, never both.

## 4. Reviewer rulings applied (2026-10-26 02:04-02:06)

- Protocol: CANDIDATE A (single guarded batch). Candidate B (two-batch +
  compensating restore) is NOT approved - its inter-batch crash windows can
  strand or misrestore ownership, and post-commit change counts detect but do
  not prevent partial state. Candidate C (copy-then-hide visibility flip)
  rejected: read-path exposure risk and no atomic flip across row sets.
- Concurrent legacy writes: FREEZE-WRITES-ON-CLAIM-START as an IN-STATEMENT
  guard on the legacy write paths (add/remove/clear), not a precheck:
  `AND NOT EXISTS(SELECT 1 FROM claims_ledger WHERE owner_key=? AND
  state='claimed')`. The legacy add is already one atomic INSERT...SELECT
  (server/accounts/d1.ts:77-81), so the guard serializes writes against the
  claim at the database. Claim-window UX is product polish, not a control.
  Accept-and-sweep rejected as the mechanism (hidden stragglers + second
  writer); optional later defense-in-depth only.
- Reviewer's naive repeated-NOT-EXIST guards and its own first "no
  self-reference" simplification were WITHDRAWN (02:05-02:06) after main
  showed self-invalidation under read-your-writes. The S1-S4 construction
  below is the replacement and is REVIEW INPUT.

## 5. The S1-S4 single-batch construction (review input; exact order matters)

ATT = fresh attempt id, K = validated legacy owner key, P = claimant
portfolio, U = claimant user. One D1 batch, four statements:

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
NOT updated by the claim; hiding is derived (§6).

Crash semantics: crash before batch commit = full rollback = claim-absent;
crash after commit = claim-complete. No intermediate states exist by
construction, which is why this candidate satisfies I3 IF D1 batch atomicity
holds - hence the proof obligations in §7.

## 6. Per-row visibility and residue semantics (resolves main 02:06 questions)

Hiding is STATE-DERIVED, never "any ledger row hides forever":
- Legacy list/read paths filter `WHERE NOT EXISTS(SELECT 1 FROM claims_ledger
  WHERE owner_key=K AND state='claimed')`. A 'rolled_back' row does NOT hide.
- Legacy write paths (add/remove/clear) carry the same state='claimed' guard
  (freeze-writes ruling).
- Native rows created by a claim are ordinary portfolio_addresses rows; their
  claim origin is recorded ONLY in claims_ledger_rows (provenance), so
  rollback can distinguish them from pre-existing native rows exactly.

Per-row lifecycle:
1. unclaimed: visible in the legacy list, writable.
2. claimed+copied: legacy row hidden; native live row exists with
   provenance disposition='copied'.
3. claimed+skipped_live_dup: legacy row hidden; the PRE-EXISTING native live
   row is untouched (label never overwritten); the legacy label survives in
   the before-image and the claim report names the set.
4. claimed+skipped_tombstone_dup: legacy row hidden; the native tombstone
   STAYS tombstoned (removed_at never flipped - no silent resurrection); the
   legacy label survives in the before-image and the claim report names it.
5. rolled_back: see below.

Claim report (shown to the user BEFORE confirm, and persisted): three
enumerated sets - rows to copy, live duplicates (kept native, legacy label
preserved in before-image only), tombstone duplicates (stay deleted). No
silent resurrect, no silent label overwrite, no silent drop.

Rollback (a separate, explicit, guarded batch):
  R1: DELETE FROM portfolio_addresses WHERE (portfolio_id,network,address) IN
    (SELECT P, r.network, r.address FROM claims_ledger_rows r JOIN
     claim_before_images b ON b.ledger_id=r.ledger_id AND b.network=r.network
     AND b.address=r.address WHERE r.ledger_id=ATT AND r.disposition='copied')
    AND (label, created_at) match the before-image exactly   -- I2: row
    -- unmodified since claim. Modified rows are NOT deleted.
  R2: UPDATE claims_ledger SET state='rolled_back', rolled_back_at=now
    WHERE id=ATT AND state='claimed'.
Policy when a copied row was natively modified after the claim: the rollback
batch FAILS CLOSED (guard detects the mismatch) and reports the modified rows;
it never restores over user edits (I2). A separate explicit "detach edited
rows and roll back the rest" action is a UX policy question (§8), not part of
the base protocol. After rollback, previously-hidden legacy rows are visible
again; rollback restores the PRE-CLAIM observable world, including any
pre-existing same-address presence in both lists - the residue report says so
per row (this is the pre-claim world, not a new mixed state; I1 constrains
the FORWARD claim's intermediate instants, which are inside one batch).
Rollback is idempotent: R2's state guard makes a second rollback a no-op.

## 7. Reclaim after rollback, and D1 proof obligations

Reclaim: the partial unique index `claims_one_active ... WHERE
state='claimed'` permits a NEW attempt (new ATT) after a rollback; a
UNIQUE(owner_key) without the state filter would block reclaim forever.
Recommendation: partial index, reclaim allowed, provenance is per-attempt so
attempts never confuse rows. POLICY DECISION for reviewer (alternative: one
claim ever per key, reclaim owner-manual).

Actual-D1 proof obligations (synthetic keys on staging; node:sqlite adapter
results do NOT establish D1 behavior):
 D1 UNIQUE-violation aborts the WHOLE batch (nothing commits).
 D2 read-your-writes WITHIN a batch: S2/S3/S4's EXISTS(claims_ledger id=ATT)
    sees S1's uncommitted insert.
 D3 two concurrent identical claims: exactly one batch commits.
 D4 statement ordering within a batch is preserved (S3's pre-copy snapshot).
 D5 guarded legacy write during a claim attempt: rejected honestly AFTER the
    ledger commit, accepted BEFORE it (no hidden stragglers).

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
7. D1 obligations D1-D5 on actual D1 (explicitly not the adapter).
8. Crash injection around the single batch: before commit -> claim-absent;
   after commit -> claim-complete; recovery sweep finds no partial state.
9. Legacy write during claim window: frozen with honest error after ledger
   commit (D5); succeeds before it and is then included in the claim.
10. Rollback unmodified: full restore of the pre-claim world; idempotent
    second rollback.
11. Rollback with natively-modified copied row: fail-closed abort + named
    rows; no restore over edits (I2).
12. Reclaim after rollback with a fresh ATT: succeeds, provenance disjoint
    (or, if policy picks one-claim-ever, honest refusal).

## 9. Environment inventory (read-only, counts/keying only, 2026-10-26)

Staging D1: entitlements=1, users=2, sessions=4, challenges=6,
tracked_addresses=0, portfolio_addresses=2 (native tombstones from earlier
reviewed exercises). ZERO Access-era user rows exist on staging - rehearsal
seeds its own synthetic keys. Production: not inspected; never test-written.

## 10. Open questions / blockers for the reviewer

1. S1-S4 soundness under actual D1 semantics (D1-D5) - the atomicity and
   read-your-writes questions stay UNRESOLVED until proven; the construction
   is not adopted as sound on documentation alone.
2. Reclaim policy: partial-unique-index reclaim vs one-claim-ever (§7).
3. Rollback-with-edits UX: fail-closed only, or an explicit detach-edited
   path (§6).
4. Whether 'rolled_back' ledger rows need retention limits/purge gating.
5. Claim entry surface placement (/account claim panel) - UX only, no route
   exists or is authorized.
