# Live data runbook (DATA-03): switch-off, rollback and drills

Scope: the read-only Ethereum lookup behind `PORTFOLIO_LIVE_DATA`. It is OFF by default. This file does not
authorize turning it on anywhere; activation needs its own approval and review.

Sources: Cloudflare Pages docs read 24 Oct 2026 (rollbacks, bindings and environment variables, Workers limits).
Statements about Cloudflare below are from those pages. Anything marked UNTESTED has not been run on this project.

## What the flag does

- `PORTFOLIO_LIVE_DATA` must equal the exact string `1`. Anything else (unset, empty, `0`, `true`, ` 1`) serves the
  simulated fixtures and makes no upstream request (unit test: "with the switch OFF the upstream is never contacted").
- The flag is read from the Pages environment by the Function. Cloudflare documents that a changed environment
  variable or binding takes effect only after a redeploy.

## Switch off (fast path first)

1. If the incident is on a **production** deployment: use Pages Deployments, "Rollback to this deployment", on the last
   production deployment that was built with live data OFF. Cloudflare documents rollback as instant for production
   deployments. Only successful production deployments are rollback targets.
2. **Preview** deployments are not rollback targets. For a preview that has live ON: set the variable to anything other
   than `1` (or remove it) for that environment and redeploy, or disable/delete the disposable live-test deployment.
   This is not instant: expect a build time.
3. Kill switch for everything: `PORTFOLIO_API_ENABLED` not equal to `true` makes the whole API answer unavailable, which
   also stops the lookup (same redeploy rule).
4. Detaching the app hostname or revoking the Access policy stops users reaching it (see CLOUDFLARE_PREVIEW.md).

## Rehearsal (do once on a disposable deployment before any ON; UNTESTED today)

1. Deploy a disposable preview with the flag OFF. Verify `/api/v1/health` reports mock and a lookup is simulated.
2. Redeploy with `1`. Verify health/networks report live and a lookup shows the live label. Use a mocked upstream or
   one approved lookup; do not loop.
3. Switch off by the preview path in step 2 above. Record the minutes from "set OFF" to "a lookup is simulated again".
4. Delete the disposable deployment and confirm its URL no longer serves.
5. Record the results in the PR. If step 3 is slow, say so in the activation request.

## Failure drill (automated, mocked upstream)

`tests/live-failure-drill.test.ts` runs the real handler and real live provider against a mocked upstream:
HTTP 429, JSON-RPC rate-limit code, 500, 503, 302 (not followed), network error, HTML 200, oversized body, JSON-RPC
error, empty result, wrong id, a hung upstream, a stalled body, and an upstream that ignores abort.
Each asserts: the HTTP status and error code, exactly one upstream request, no balances substituted, `no-store`, and
that neither the body nor the log contains the address, upstream text or endpoint. A 25-request burst asserts 25
upstream requests (no retry or amplification). Not covered: real Cloudflare runtime behaviour, real vendor limits, and
real latency. Those need a disposable deployment and are UNTESTED.

## Limits that apply (documented, not measured here)

- Cloudflare Workers Free (Pages Functions count against it): 100,000 requests/day, 10 ms CPU per request (network wait
  does not count), 50 subrequests per request. One lookup is one subrequest to the RPC endpoint.
- The RPC vendor (PublicNode, `ethereum-rpc.publicnode.com`) publishes no numeric rate limit that we found. Its terms
  call the service discretionary and "as is", reserve the right to change or discontinue it without notice, and give no
  SLA. Its privacy policy says that as an RPC provider it will not store IP addresses or data for more than 24 hours and
  that IP addresses are not correlated to wallet addresses. This is vendor text, not audited by us. Requests reach the
  vendor from Cloudflare, not from the user's browser, so the user's IP is not sent; the pasted address is.
- In-app limits are per Function instance and are not a global cap.

## What a failure looks like to the user

429 "data source is rate limiting", 503 unavailable, 504 too slow, 502 unusable answer. None shows balances, and the
page says the result cannot tell whether the wallet is empty. Diagnostics are a fixed step name and small numbers only.
