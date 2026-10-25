# Portfolio accounts — storage decision (2026-10-24)

Status: owner explicitly deferred persistence on 2026-10-24; finish reliability and source preparation only. Storage alternatives below remain proposals. No persistence, binding, migration or credentials are authorized by this document.
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
