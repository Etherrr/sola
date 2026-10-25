# Portfolio accounts — storage decision (2026-10-24)

Status: the 2026-10-24 handoff text stated the owner explicitly deferred persistence; independent review found no owner-channel confirmation of that choice, so it is preserved here as reported state, not established fact. Storage alternatives below remain proposals. No persistence, binding, migration or credentials are authorized by this document.
Owner: web-app agent. Baseline: production release branch a63b465. This branch owns retry UX, request-race protection and approval-ready account/market preparation; other developers should coordinate overlapping work before review.

## Decision to approve

| Option | Returning access | Isolation and privacy | Retention / deletion | Cost / limits |
| --- | --- | --- | --- | --- |
| Local-only, explicit opt-in | Same browser only | Addresses/labels remain on the device; browser storage is readable by app scripts and accessible to people sharing that browser. Partition by a server-verified account identity; never treat that partition as server authorization. Clear visible data whenever verification is lost. | Until user clears or browser evicts; individual delete and clear-all. No reliable remote deletion. | No new service costs; browser quota/eviction varies. |
| D1 server-side (recommended for real account isolation and cross-device access) | Any device admitted by existing Access policy | Cloudflare receives account-linked labels and public addresses. Verify JWT signature, issuer, audience and expiry for EVERY operation; use verified issuer + subject as owner, never an email supplied by client. Parameterized SQL includes owner predicate on every read/update/delete. No arbitrary owner ID accepted. | Proposed: user deletes individual addresses or all saved data; 90 days of inactivity before purge. Backup recovery windows must be disclosed before launch. | Published Free: 5M rows read/day, 100K written/day, 5GB total; operations fail at limits. No automatic upgrade approved. |
| KV server-side | Cross-device | Same authentication requirements; per-account keys are not authorization. Eventual consistency complicates deletion and concurrent edits. | Explicit delete plus documented propagation/backup window required. | Published Free: 100K reads/day, 1K writes/day, 1K deletes/day, 1K lists/day, 1GB. Not selected. |

Recommendation is a design proposal, not adoption. Start with at most five labeled addresses per network, 40-character plain-text labels, network-qualified deduplication, and no balance history. Never store JWTs, emails in client keys, provider payloads, IPs or account/address contents in app logs. No analytics. App browser responses are private/no-store. Balance lookups continue to disclose addresses sent to PublicNode.

## Server design after approval

Use a D1 binding available only to Pages Functions. Account key derives from verified `iss` + `sub`, with validated bounded strings. Existing JWT verification must return validated claims from the same verification operation; decoding alone is insufficient. No password auth or expanded Access audience. An authenticated service token without a user subject is insufficient for portfolio-account access.

Table: `tracked_addresses(owner_issuer, owner_subject, network, address, label, created_at, updated_at)` with unique composite owner/network/address key. All mutations revalidate network/address and same-origin JSON request, bounded body, label and account cap. Enforce caps transactionally; no application-only count-then-insert race. Deletion is idempotent and scoped by verified owner. Do not save balances/prices; fetch only on explicit user action. Never query all owners for UI work.

UI: verified account → address lists grouped by network → label/add/remove → manually refresh selected account holdings. No implicit ownership claim about an address. Reverification hides private state first; identity change/expiry clears results and cancels pending UI writes. Account list loads must not trigger provider lookups. Display observations from supported addresses only, nullable priced subtotal, unsupported coverage, and separate balance/response/price times. Demo remains an explicit separate state and cannot fill a failed live result.

## Acceptance / release gates

Test signed users A/B across list/add/update/delete and object-reference attacks; forged/expired/missing JWT, missing subject, client-owner spoofing, duplicate/case normalization, caps under concurrency, quota failure, delete/clear and stale responses after identity switch. Test decimal-safe aggregation, unpriced values, mixed network coverage and zero balances separately from read failures. Exercise storage deletion and verify actual backup retention before saving real user data.

Rollback: retry UX has no migration. A future storage feature must be disabled independently and keep its database for owner-reviewed export/deletion; reverting UI does not delete stored personal data. No migration/production deploy or Access/DNS change is included here.

Sources checked 2026-10-24: https://developers.cloudflare.com/d1/platform/pricing/ and https://developers.cloudflare.com/kv/platform/pricing/. Account-specific usage, region configuration, backup retention and current production bindings have NOT been inspected. Proposed retention requires owner acceptance and an implemented purge path.

## Review addendum (2026-10-24, independent review)

- Identity key: the Access `sub` claim is the user ID, unique to an email address per Zero Trust account, per Cloudflare's application-token documentation (checked 2026-10-24). Caveat: a user removed and re-added to the organization receives a NEW `sub`; their saved rows would be orphaned. The purge path below must cover orphaned owners.
- Purge and backups are NOT implemented. The 90-day inactivity purge is a proposal without a scheduled job; D1 backup/Time-Travel recovery windows are uninspected and must be disclosed before any real user data is saved. Deletion today means deletion from the live table only.
- Rate limiting has two honest layers. Layer 1 is per-isolate process memory: distributed Pages instances each hold their own counters, so it is NOT a durable global guardrail by itself. Layer 2 (requires the approved D1 binding) is one atomic UPSERT ... RETURNING count per UTC-aligned fixed window, failing CLOSED (deny with bounded retry delay) on any storage error. The account cap and unique-key isolation are verified on real SQLite executing the actual migration and adapter SQL (tests/d1-adapter.test.ts over node:sqlite); that is D1-compatible statement execution, still not a workerd D1 binding.
- Migration: migrations/0001_accounts_and_counters.sql is applied once, only after binding approval, through the owner-approved path.

## Review addendum 2 (2026-10-24, independent-review findings resolved)

Six findings from the independent reviewer, all resolved in this branch; regressions in
tests/d1-adapter.test.ts and tests/accounts.test.ts (265 tests total):

1. At-cap relabel returned the old label with ok:true on D1 (memory adapter updated it).
   The D1 add is now UPDATE-first, then a capped INSERT for genuinely new rows; verified on
   real SQLite at exactly the cap, with a memory-adapter parity test.
2. Counter rows collided across features: the lookup window (10/min) and mutation window
   (30/min) shared the (owner, window_start, window_ms) primary key, so one feature's
   traffic could consume the other's budget. rate_counters now has an explicit scope
   column; the primary key is (scope, owner, window_start, window_ms); the migration,
   adapter and both call sites ('lookup' in the resolve handler, 'mutation' in the accounts
   handler) are updated, with a scope-independence regression.
3. Counter sweep was lookup-only and fire-and-forget (a returned response could terminate
   cleanup, so accounts-only traffic would grow the table forever). The sweep is now a
   single awaited indexed DELETE over closed windows in ALL scopes, invoked hourly per
   isolate from both enabled features, with a both-scopes regression.
4. Subject-less identities (e.g. service tokens) skipped the lookup throttle (fail open).
   With PORTFOLIO_LOOKUP_LIMIT=1 the resolve hook now fails CLOSED: a verified token
   without a user subject gets 401, same as the accounts handler.
5. The accounts handler read the full body before enforcing the 2KB cap and never used
   bodyDeadlineMs. It now rejects an over-cap declared content-length up front and reads
   the body through the same bounded/deadlined reader as the resolve handler (413 over cap,
   408 on deadline), with declared-length and streamed-body regressions.
6. Disabled-before-auth disclosure: no behavior change. The pre-auth 503
   ('disabled'/'not_configured') matches the existing resolve handler's published contract;
   both endpoints sit behind Cloudflare Access, so these categories reach only
   Access-admitted callers. Clarified in a code comment.

## Review addendum 3 (2026-10-24, retention and backup facts settled)

Supersedes addendum 1's "backup/Time-Travel uninspected" line.

- Plan-specific restore windows (D1 platform limits, checked 2026-10-24,
  https://developers.cloudflare.com/d1/platform/limits/): Time Travel point-in-time
  recovery is 7 days on Workers FREE, 30 days on Workers Paid; restores are capped at
  10 per 10 minutes per database. Time Travel is always on, with no documented opt-out
  or way to shorten the window (https://developers.cloudflare.com/d1/reference/time-travel/).
- Exact disclosure wording: deleting an address or clearing an account removes rows from
  the live table immediately, but they remain restorable through D1 Time Travel for up to
  the plan window (7 days on Workers Free). After the window, D1's DOCUMENTED restore path
  can no longer recover them. That is a restore-window statement, NOT a total-erasure
  guarantee: Cloudflare publishes no provider-side erasure commitment beyond it (internal
  backups, logs and similar retention are outside the published scope), and any export the
  owner makes (wrangler d1 export) retains data independently.
- A tracked address stored with a verified identity (iss#sub) and a user label is personal
  data, even though the address itself is public on-chain. Retention policy must treat it
  as such.
- UI gap (corrected 2026-10-24): the candidate has NO account-management UI. List, add,
  remove and clear are implemented, route-wired (functions/api/v1/portfolio/accounts.ts)
  and tested at the API level only. Until minimal controls are built and render-verified,
  deletion is an operator/API capability, not a user-facing one.
- Minimal retention recommendation for this small private app: adopt delete/clear as the
  stated policy and EITHER ship minimal render-verified delete/clear controls with
  activation OR state operator-run deletion on request as the interim; accept the plan
  window disclosure (7 days on Workers Free) with the no-total-erasure-guarantee wording
  above; defer the 90-day inactivity job (requires new last-seen tracking; little value at
  this scale); handle orphaned identities (re-added Access users get a new sub) by manual
  review when Access membership changes.
