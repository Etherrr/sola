# Account-data claiming: Access-era rows to native accounts (B.3)

Status: DESIGN DRAFT for independent review, 2026-10-26. No implementation,
route activation, real-data re-keying, or production access is authorized by
this document. Synthetic staging rehearsal only, after review.

Plan sources: Phase B.3 ("tested account-data migration/claiming process,
preserving labels and privacy preferences without making trust assumptions"),
plan line 78 (no silent Cloudflare-identity-to-Sola-user assumption; preserve
saved addresses only after secure proof of account continuity), §11 ("auth
migration is rehearsed on staging, rollback documented").

## 1. Data model (source of truth: migrations/)

Legacy (Access era, migrations/0001_accounts_and_counters.sql):
- `tracked_addresses(owner_issuer_subject, network, address, label, created_at,
  updated_at)` - PK (owner_issuer_subject, network, address). The owner key is
  the Cloudflare Access `iss` + `sub` pair. This is the only Access-era user
  data table; `rate_counters` is operational and is never claimed.

Native (migrations/0002_native_auth.sql, 0003):
- `users` / `auth_identities(kind, identifier)` / `sessions`.
- `portfolios` UNIQUE(user_id) (0003, race-safe ensurePortfolio).
- `portfolio_addresses(portfolio_id, network, address, label, verification,
  created_at, removed_at)` - PK (portfolio_id, network, address).

Claim mapping: each legacy row becomes one `portfolio_addresses` row under the
claimant's single portfolio, with `label` preserved verbatim, original
`created_at` preserved, `verification='watched'` (pasted watched addresses
carry no ownership proof - existing semantics, server/portfolio/addresses.ts),
`removed_at=NULL`. `updated_at` has no native column; the before-image retains
it (see §5).

## 2. Continuity and threat model

The binding. A claim binds a legacy owner key to a native user only when the
claim request carries a Cloudflare Access assertion validated AT CLAIM TIME by
the existing verifier (server/portfolio/access.ts `checkAccessJwt`, jose:
signature, alg, exp/nbf, issuer=https://teamDomain, audience, required exp,
key fetch fails closed past 6h staleness) whose validated `iss`+`sub` equals
the legacy `owner_issuer_subject` byte-for-byte.

Email is not proof. An Access-verified email and a native-OTP-verified email
are two logins to one inbox: one factor, and the plan forbids merging on
email text alone. The email claim may be shown as a consistency hint only.

Cases:
- Forged/assertion from another app: rejected by signature + iss + aud checks.
- Replayed stale assertion: rejected by exp/nbf at claim time.
- Subject rotation (user removed and re-added to the Zero Trust org receives a
  NEW sub - documented hazard, docs/PORTFOLIO_ACCOUNTS_DESIGN.md): validated
  iss+sub no longer equals the legacy key, so no claim is possible. Those rows
  are orphans: owner-manual held path only, never silent reassignment.
- Racing or replayed claims for the same owner key: exactly one must win (see
  candidate protocols; the ledger uniqueness constraint is the arbiter).
- UI spoofing an email match: irrelevant - the email is never consulted for
  the binding.

## 3. Required invariants (review gate)

- I1 - never expose mixed ownership: every row is visible under exactly one
  owner key at every observable instant, or hidden.
- I2 - never restore over a concurrent legitimate update: any compensating
  restore must be conditional on current state still equalling the post-claim
  state it intends to undo.
- I3 - defined recovery after a crash at every boundary: pre-ledger,
  post-ledger pre-rekey, mid-rekey, post-rekey pre-tombstone,
  mid-compensation. Each intermediate state must be detectable on next boot
  and converge to claim-absent OR claim-complete, never both.

## 4. Protocol candidates (UNRESOLVED - for reviewer evaluation)

Grounded facts: D1 `batch()` is transactional - "if a statement in the
sequence fails... it aborts or rolls back the entire sequence"
(developers.cloudflare.com/d1/worker-api/d1-database/#batch, fetched
2026-10-26). BUT an UPDATE matching zero rows SUCCEEDS (0 changes): rollback
-on-error is not rollback-on-no-op, so guards must be constraints, not row
counts. `meta.changes` per statement is available post-commit for detection,
not prevention.

Candidate A - single-batch guarded claim:
One batch: INSERT INTO claims_ledger(owner_key, ...) ... with
claims_ledger.owner_key UNIQUE (the atomic arbiter; a replayed/concurrent
claim violates it and aborts the whole batch before any re-key) + guarded
re-key INSERT...SELECT statements conditioned on the ledger insert. Within
one batch, statements commit or roll back together, so there is no
interleaving window INSIDE the commit. Open: SQLite INSERT...SELECT can
reference the ledger row inserted earlier in the same batch only if D1
executes the batch in one transaction with statement ordering preserved
(docs say sequential) - MUST be proven on actual D1, not only the node:sqlite
adapter. Crash inside the batch = full rollback (I3 satisfied at the one
boundary). Concurrent LEGACY writes (user still using Legacy Track during
their claim) are the hard case: a legacy INSERT after the pre-read but before
the batch would be missed by the re-key SELECT and then sit unclaimed under a
claimed key - candidate mitigation: tombstone the owner key FIRST inside the
same batch and make legacy writes reject tombstoned keys (a write-path
change), or accept-and-sweep (recovery sweep re-claims stragglers; must not
violate I1 during the window). UNRESOLVED.

Candidate B - two-phase with conditional compensation:
Batch 1 reserves via ledger INSERT...SELECT WHERE EXISTS(unclaimed rows),
verified by meta.changes==1; batch 2 writes before-image + re-key; mismatch
triggers compensating restore. Open failure windows (must be enumerated, not
waved): crash between reservation and re-key strands a claimed-but-unmoved
key; compensation can misrestore over concurrent legitimate updates unless
each restore statement is conditioned on current state (I2). Detection is
post-commit; prevention is not available across batches. Included for
completeness; currently disfavored.

Candidate C - copy-then-hide with visibility flip:
Write native rows hidden (a pending_claim marker), flip visibility in one
guarded UPDATE, tombstone the legacy key after. Open: flip atomicity across
row sets, read-path changes everywhere to respect the marker (I1 exposure
risk if any read path misses it), and the same concurrent-legacy-write
problem as A.

The concurrent-legacy-write problem (claims racing active Track usage) is
common to all three and is called out as the reviewer's named hazard to rule
on: freeze-writes-on-claim-start (write-path gate on tombstone) vs
accept-and-sweep (recovery pass) vs claim-window UX (claim only from a
signed-out-of-Track state). 

## 5. Rollback and evidence

- Before-image: full copy of the claimed legacy rows (including `updated_at`,
  which the native schema drops) written before any re-key, keyed by
  claims_ledger id.
- Old keys are TOMBSTONED (claims_ledger marks the owner key claimed), never
  purged, while rollback can restore. Purge is a separate owner-approved
  operation after the rollback window.
- Rollback = restore from before-image with per-statement state conditions
  (I2), then ledger marked rolled-back. Rollback availability and the purge
  gate are part of the rehearsal.

## 6. Rehearsal matrix (synthetic staging rows only, after review)

Seed synthetic legacy rows under a synthetic owner key; synthetic native user.
1. Happy path: labels/created_at verbatim, counts reconcile, verification
   always 'watched', ledger + before-image written, old key tombstoned.
2. Replayed claim: UNIQUE abort, zero partial state.
3. Two concurrent claims, same owner key: exactly one wins; loser's session
   gets an honest already-claimed state.
4. Zero-match re-key (rows removed between pre-read and commit): detected;
   no successful ledger state; restore leaves before-image intact.
5. Crash injection at every I3 boundary (kill between statements via
   injected fault points in the rehearsal harness): next-boot recovery
   converges to claim-absent or claim-complete.
6. Concurrent legacy write during claim: behavior per the reviewer's ruling
   on §4; asserted against I1.
7. Adapter honesty: node:sqlite results do NOT establish D1 behavior - the
   guarded batch and guard-miss rollback are re-verified against actual D1 on
   staging before any real claim path exists.
8. Before-image consistency spot-check, including `updated_at` fidelity.

## 7. Environment inventory (read-only, counts/keying only)

Staging D1 (2026-10-26 05:49Z baseline): entitlements=1 (owner test account),
users=2, sessions=4, challenges=6, tracked_addresses=0, portfolio_addresses=2
(native tombstones from earlier reviewed exercises). No Access-era user rows
currently exist on staging - rehearsal seeds its own. Production inventory:
not inspected; production D1 is never test-written (standing constraint).

## 8. Open questions

1. Reviewer's ruling on the concurrent-legacy-write hazard (§4).
2. Which candidate protocol (A/B/C) after failure-window review.
3. Claim entry point (an explicit /account claim surface is implied; nothing
   routes today).
4. Rollback window length and purge gating.
5. Whether `updated_at` preservation matters beyond the before-image.
