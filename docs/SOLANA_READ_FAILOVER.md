# Solana read failover — source review note (2026-10-25)

Status: PREPARATION ONLY. No code, config, provider or flag change is authorized by this
note. Baseline: production head eceee26. Related: docs/LIVE_DATA_RUNBOOK.md.

## Authority provenance of the runbook restriction (recovered 2026-10-25)

The runbook line "Do not switch providers as an incident workaround without approval"
was introduced in commit 76b676e - the Codex reliability handoff branch, i.e.
AGENT-authored operating guidance, not an owner restriction. A search of the owner's
channel messages (2026-10-20..25, provider/PublicNode/RPC terms) found NO owner
instruction restricting provider changes. The owner-established boundaries that DO
bind this work are: (a) free-tier operation and Access preservation (v0.2 brief,
phonemsg-01M5MVMX4RFQ4FK6NY0KDQ6FM2, verbatim in docs/NATIVE_ENTRY_DESIGN.md), and
(b) "Do not ... request production credentials without approval" (same brief). An
additive, keyless, free failover stays inside all of these; the runbook line remains
good operating guidance against UNREVIEWED incident switching, and this delta keeps
the review gate rather than relabeling around it.

## Problem

SOL balance reads use one shared free endpoint (`https://solana-rpc.publicnode.com`,
server/portfolio/live-provider-solana.ts). Upstream HTTP 429 and RPC -32005/-32029 map
to `rate_limited` and render honestly as unavailable. Live reads on 2026-10-25
(07:27-07:28 UTC) returned partials consistent with shared free-tier throttling.
PublicNode publishes no numeric free-tier limit (runbook; vendor site). Ethereum reads
via PublicNode and Chainlink feeds were reliable in the same checks.

## Candidate secondary endpoint (verified 2026-10-25, ~07:51 UTC)

`https://api.mainnet.solana.com` - the Solana Labs public mainnet endpoint, per
https://solana.com/docs/references/clusters: "public endpoints are subject to rate
limits"; "the specific rate limits listed on this document are not guaranteed to be the
most up-to-date". It is free and keyless. It is also shared and throttled; treat it as
an independent second chance, not a reliable tier.

Owning-source production guidance, verbatim from the same page: "For production
infrastructure, use the RPC provider guide to compare private services and find the
maintained provider directory." This app is not exempt from that guidance merely
because it is private: the free public endpoints carry no SLA and are not a
reliability solution. This failover is an availability improvement within the free
tier, not production-grade reliability; a keyed provider remains a separate owner
decision (credentials).

## Vendor terms (fetched live 2026-10-25 ~07:52 UTC)

PublicNode terms (https://www.publicnode.com/terms): freely revocable, non-exclusive
license; no numeric limits published; limits changeable at any time; prohibited:
abuse, interference, and "bypass the measures we may use to prevent or restrict
access". The proposed failover HONORS PublicNode's 429 signal (we stop asking
PublicNode for that request) and asks a DIFFERENT provider instead - it does not
circumvent, retry-storm or evade PublicNode's own measures. Ordinary read-only RPC
queries from an app backend are the intended use of the service.

## Actual failure categories (from server/portfolio/live-provider-solana.ts)

rate_limited (HTTP 429, RPC -32005, RPC -32029), timeout, unavailable, bad_response.
Failover triggers ONLY on rate_limited. A genuine upstream outage (unavailable) is
not masked by failover in this proposal - that keeps failure semantics honest.

## Load, privacy and request-only implications

- Load: at most ONE extra upstream request per user-initiated lookup, only when the
  primary says rate_limited. No background polling, no automatic retry loops.
- Privacy: on a failover the public address is disclosed to a SECOND RPC node. The
  result and the privacy line must name the endpoint actually used. Note the paired
  test cost: tests/copy-claims.test.ts currently pins the exact string "public Solana
  node (PublicNode)" in features/portfolio/track-form.tsx; the reviewed delta must
  update both together (endpoint-host-aware labeling).
- Request-only promise: intact. No new persistence, no scheduled work, no change to
  lookup cadence or the 429/Retry-After browser cooldown.

## Evaluation: bounded failover vs honest unavailability

Honest unavailability is retained whenever both endpoints fail. Bounded failover adds
modest availability at near-zero cost (one extra request on an explicit throttle
signal) with two real costs: endpoint-accurate labeling complexity, and one extra
upstream call during genuine congestion (bounded to one). Verdict: justified under
free tier; expectations stay honest - it converts some partials into reads and cannot
remove shared free-tier throttling.

## Proposal sketch (for review, not implementation)

- On a `rate_limited` outcome (and only that category) from the primary endpoint, retry
  the same read once against the secondary endpoint within the same request budget.
- Result copy must name which endpoint produced the balance (the existing
  address-destination disclosure pattern extends to "via <endpoint host>"); a failover
  read is never labeled as coming from the primary.
- Both endpoints receive the public address on their respective attempts; the privacy
  disclosure already covers that addresses go to public RPC nodes.
- No change to failure honesty: if both fail, the same unavailable rendering applies.
- No change to the 429/Retry-After browser cooldown semantics; a failover success is a
  success, not a reason to poll more.
- Expectation honesty: this converts some partials into reads. It cannot remove shared
  free-tier throttling, and the secondary may be throttled at the same time.

## Out of scope (separate decisions)

SPL token coverage (heavier RPC weight; realistic path is a keyed provider free tier -
a credential/account decision for the owner). Any paid plan (excluded by free tier).
Changing the Ethereum path (reliable tonight). Provider removal/switch rather than
additive failover (the runbook's approval-gated case).

## Acceptance gates if approved

Unit tests: failover only on rate_limited (not on timeout/unavailable/bad_response),
secondary result labeled with its own endpoint host, both-fail keeps the existing
unavailable rendering, no retry storms (single failover attempt, no loops). e2e:
mocked primary-429/secondary-success shows the correct endpoint label and privacy
line. Live verification post-release: real SOL read on the production host, honest
rendering either way.
