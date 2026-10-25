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

## Official sources (read 24 Oct 2026)

- Pages rollbacks: https://developers.cloudflare.com/pages/configuration/rollbacks/
- Pages bindings and environment variables (redeploy needed): https://developers.cloudflare.com/pages/functions/bindings/
- Pages Functions pricing and Workers limits: https://developers.cloudflare.com/pages/functions/pricing/ and https://developers.cloudflare.com/workers/platform/limits/
- PublicNode terms and privacy: https://publicnode.com/terms and https://publicnode.com/privacy

## Switch off

Two different facts must be shown separately: the ACTIVE endpoint is OFF, and every RETIRED live endpoint is gone.

1. **Production alias**: Pages "Rollback to this deployment" on the last production deployment built with live OFF moves
   the production alias (Cloudflare documents this as instant, production only). It is a mapping change. It does not
   kill the earlier immutable deployment: a deployment built with live ON stays reachable at its own hash URL until it
   is deleted.
2. **Preview**: previews are not rollback targets. Set the variable to anything other than `1` (or remove it) for that
   environment and redeploy, or delete the disposable live-test deployment.
3. `PORTFOLIO_API_ENABLED` not equal to `true` makes the whole API answer unavailable (same redeploy rule).
4. Inventory every live-capable endpoint before and after: branded hostname, branch alias, per-deployment hash URL,
   and the `pages.dev` project URL. Record which deployment ID each one maps to.

## Verifying a switch-off

- ACTIVE endpoint: from a fresh request, health reports mock and a lookup returns the simulated label and fixture data.
  This proves the NEW target is OFF. It does not prove an OLD deployment is off.
- RETIRED exact hash (a deleted deployment): proof is the vendor's own "deployment not found" answer for that exact
  hash host (a 404 DeploymentNotFound style page), meaning nothing executes there. A network failure, a login redirect,
  a 401, or the absence of an API deployment ID is not proof. A deleted host cannot be asked to mock.
- Timing: a reviewer measured 3 min 25 s for a DELETE to propagate on a preview. That is a delete measurement only, not
  a flag-change measurement. Re-check on a fixed schedule: one fresh request at about 1, 3 and 5 minutes after the change (never faster than one request per minute). Make one final fresh check at 10 minutes. If the active endpoint is still not OFF, or a retired hash still answers, stop checking and escalate to the reviewer or owner instead of polling further.
- Detaching a hostname or revoking an Access policy is NOT part of routine rollback. It limits who can reach the app but
  does not stop the Function for anyone who still passes Access, and it is not an engine or alias kill switch. It is a
  separate, reviewed access action under its own authority.

## Rehearsal (do once on a disposable deployment before any ON; UNTESTED today)

1. Deploy a disposable preview with the flag OFF. Verify `/api/v1/health` reports mock and a lookup is simulated.
2. Redeploy with `1`. Verify health/networks report live and a lookup shows the live label. Use a mocked upstream or
   one approved lookup; do not loop.
3. Switch off by the preview path above. Record the minutes from "set OFF" to "a lookup is simulated again" on the
   active endpoint (a flag change timing, separate from delete timing).
4. Delete the disposable deployment and confirm its exact hash host gives the vendor deployment-not-found answer.
5. Record the results in the PR. If step 3 is slow, say so in the activation request.

## Failure drill (automated, mocked upstream)

`tests/live-failure-drill.test.ts` runs the real handler and real live provider against a mocked upstream:
HTTP 429, JSON-RPC rate-limit code, 500, 503, 302 (not followed), network error, HTML 200, oversized body, JSON-RPC
error, empty result, wrong id, a hung upstream, a stalled body, and an upstream that ignores abort. The ignores-abort case proves the caller finishes at the deadline; it does not prove the underlying request was cancelled.
Every case asserts the HTTP status and error code, exactly one upstream request, no balances substituted, `no-store`,
that neither the body nor this app's log line contains (Cloudflare's own edge logs are not covered) the address, upstream text or endpoint. The timeout cases also assert elapsed time lands near the configured deadline. The redirect case uses a fake fetch that really follows a 3xx when the request does
not say `redirect: 'manual'`, and the test asserts the request's destination, method, `redirect` and abort signal.
The unit test runs the real Access JWT verification but supplies the signing keys directly (only the JWKS fetch is stubbed), so it
covers one RPC request per lookup, not the total subrequests of a real request (the Access key fetch is cached for an hour and is additional) and
not total CPU, which is unknown. A 25-request burst shows outbound
requests are 1:1 with lookups (no retry); it is NOT an admission limit and shows no backpressure. Not covered: real Cloudflare runtime behaviour, real vendor limits, and
real latency. Those need a disposable deployment and are UNTESTED.

## Limits that apply (documented, not measured here)

- Cloudflare Workers Free (Pages Functions count against it): 100,000 requests/day, 10 ms CPU per request (network wait
  does not count), 50 subrequests per request. One lookup makes one subrequest to the RPC endpoint (the cached Access key fetch is additional).
- The RPC vendor (PublicNode, `ethereum-rpc.publicnode.com`) publishes no numeric rate limit that we found. Its terms
  call the service discretionary and "as is", reserve the right to change or discontinue it without notice, and give no
  SLA. Its privacy policy says that as an RPC provider it will not store IP addresses or data for more than 24 hours and
  that IP addresses are not correlated to wallet addresses. This is vendor text, not audited by us. Requests reach the
  vendor from Cloudflare, not from the user's browser, so the user's IP is not sent; the pasted address is.
- Controls that exist in the source: Access JWT required; request body capped and time-limited; at most 5 addresses per
  lookup; one upstream request per lookup with an 8 s deadline; response capped at 64 KiB; no redirects followed; no
  retries; Access key fetch cached with its own backoff. There is NO lookup rate limiter and NO concurrency or admission
  limit in the app: an authenticated user can issue lookups as fast as Cloudflare allows, each costing one subrequest,
  until the Workers Free daily request quota or the vendor throttles. Any bound beyond that (for example a
  Cloudflare rate-limiting rule or an in-app cap) is not built and is a separate decision.

## What a failure looks like to the user

429 "data source is rate limiting", 503 unavailable, 504 too slow, 502 unusable answer. None shows balances, and the
page says the result cannot tell whether the wallet is empty. Diagnostics are a fixed step name and small numbers only.

## Manual retry UX (2026-10-24)

The browser now reads the API's `Retry-After` on 429 (integer seconds or HTTP date; missing/invalid defaults to 30 seconds), displays a minimum wait, and disables submit, simulated-example requests and the explicit Retry lookup button during that wait. Expiry only enables a user action; there is no provider polling or automatic retry. This cooldown is a browser usability control, not a server-side rate limiter. A retry does not guarantee recovery. Switching networks cancels the browser request and invalidates its UI result; it cannot guarantee cancellation of upstream work already started. Changing networks retains an active cooldown.

Reported Solana failure: source maps upstream HTTP 429 and RPC -32005/-32029 to rate_limited; the API maps that category to 429 with 30 seconds minimum wait. This is consistent with throttling, not log-confirmed incident attribution. No production request logs, bindings or flag values were inspected during this branch's work, and no genuine live lookups were performed. To confirm an incident, correlate sanitized request ID, provider_failure category/step and timestamp through authorized Cloudflare access. Do not paste identities, tokens or addresses into logs or PRs. Do not switch providers as an incident workaround without approval.

Balance observation, response completion and each price-feed update now have separate labels in Track. Solana observation now records receipt of its balance response, rather than reusing the Ethereum pricing block timestamp; it is not an inferred Solana block time. No new price freshness or executable-quote claim is made. See [account design](PORTFOLIO_ACCOUNTS_DESIGN.md) and [market source review](MARKET_SOURCES_REVIEW.md) for pending decisions.
