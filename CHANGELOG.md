# Changelog

Document **material, user-visible, architecture, security, or process changes**. Use dates and an Unreleased section. Do not record future work as completed.

## Unreleased

- DATA-03 live read-only Ethereum provider (default OFF, not deployed): `PORTFOLIO_LIVE_DATA` must be exactly the string `1` to select it; anything else keeps the simulated fixtures. It reads ETH and four listed tokens (USDC, USDT, DAI, WETH) over a public JSON-RPC endpoint (PublicNode, no key) and prices them from Chainlink USD feeds read through the same endpoint (no second vendor). One batched request per lookup: 64 KB response cap, no redirects, request timeout from the handler, explicit rate-limited/unavailable/timeout/bad-response errors, per-token read failures are partial results with a warning (never a zero balance), prices only when the feed has 8 decimals, a positive answer and is within its heartbeat margin (ETH/USD 2 h, stablecoins 25 h), otherwise Unknown. Not shown: any token outside the list, NFTs, DeFi positions. WETH uses the ETH/USD feed. Privacy: the pasted address and the server IP go to the RPC provider; its published policy says RPC IPs and data are kept at most 24 hours (not verified). The Track page asks `/api/v1/health` for the mode and labels itself live, simulated or unconfirmed. Cost: none within best-effort public limits (no SLA). Rollback: unset the variable (instant) or revert this commit.
- APP-03 overview: allocation donut by holding (keyed by asset id, with its basis stated), phone holdings list that keeps values and debt direction on screen.

- DATA-02 key-fetch fix: Cloudflare's runtime (workerd) rejects `redirect: 'error'` on `fetch`, so every Access key fetch failed and all authenticated requests got 401 (found by running the real runtime locally against the public certs endpoint). The fetcher now uses `redirect: 'manual'` and treats any 3xx as a failed fetch. Key-fetch failures log a fixed sub-category (timeout, http_status, too_large, parse, cooldown, fetch_error).
- DATA-02 auth diagnostics: `ACCESS_TEAM_DOMAIN` must be a bare `<team>.cloudflareaccess.com` host; anything else (scheme, slash, port, path, other domain) now returns 503 not_configured instead of silently rejecting everyone with 401. Every 401 logs one finite reason category (missing_assertion, token_too_large, key_fetch_failed, an allowlisted jose error code, plus the claim name aud/iss/exp/nbf), at most once a minute per category per isolate, never a token, claim value, email or address, and never in the response.
- DATA-02 round 3: Access JWT verification now uses `jose` 6.2.13 (exact-pinned, MIT, no dependencies, server only; RS256, issuer, audience, exp, crit handled by the library) with our own bounded key fetcher kept (jose has no failure cooldown or response cap). API responses add referrer-policy, noindex, CSP frame-ancestors none and CORP. Still fixture-only, default off.
- DATA-02 hardening and slice 2: bounded request body (Content-Length precheck plus streamed 2 KB cap, stream errors return contract JSON), exact JSON media type, Access key fetch with 3 s deadline, 32 KB cap, 10-key cap, 1 h cache, one rate-limited refresh on unknown kid, no redirects, last-good keys on failure, 8 KB JWT cap, `crit` rejected. `/track` now has a SIMULATED fixture lookup form (same-origin POST only; no provider call). Hardening round 2: stale key ceiling 6 h then fail closed, 60 s attempt cooldown that also covers failures, one in-flight key fetch, 3 s body-read deadline (408), hung key fetch answers 401. The browser validates the whole response (mode/simulated must agree, decimals, totals, wallet equals the address asked) and never shows an unexpected answer as a wallet; feature-off 503 reads as switched off. Still fixture-only, default off, no rate limiter.

### v0.2 EDU-02 security decision lab (2026-10-23, stacked on EDU-01 and unmerged PR #3)
- Added `/learn/security-lab/`: four invented, simulated prompts (a connection request, a request for a recovery phrase, an unlimited spending approval and a look-alike giveaway link). Each choice reveals its consequence and a safer habit in place, with Ethereum-specific wording and ethereum.org sources.
- Radios and buttons only: no text entry and no wallet access. Scenario answers are not stored or sent anywhere; the answered count lasts for the visit only. (Normal page hosting and the external source links are unchanged.)
- Linked from the learning library; added to the export route check; unit tests assert no wallet, network, storage or text-input code; an e2e test covers the choice flow; automated accessibility checks cover the route.
- Cost: none. No new dependencies. Rollback: revert this commit. Not deployed; not merged.

### V3.1 app consistency (2026-10-23, stacked on EDU-01 and unmerged PR #3)
- Added the corporate gold and purple monogram as the favicon, Apple touch icon and header brand mark (replacing the CSS "S"). Assets are the images already published on solacapitalpartners.com.
- Renamed the nav item and page title for `/track` to "Address lookup" with a "soon" marker, because lookup is off in this preview.
- Footer now carries the corporate wording "Content is informational and is not investment advice" plus a simulation-specific line: figures in this preview are simulated, not market data. The existing educational and no-custody notice is kept.
- Recorded the canonical protected preview domain in the docs: the app is served at app.solacapitalpartners.com behind Cloudflare Access, from the Pages production branch `feat/edu-01-network-journey` (not main). Rollback: use the Pages Rollback action on the previous successful production deployment, or revert this commit.
- No new dependencies, routes, wallet access, data sources or Access changes. Still static, simulated and read-only.

### v0.2 EDU-01 network journey (2026-10-23, stacked on DES-01 and unmerged PR #3)
- Added `/learn/network-journey`: a fully simulated Ethereum transfer between fictional people with play, pause, step, scrub and replay, a live status line, a worked fee example and the same journey as text.
- Keyboard and reduced-motion behaviour tested; no wallet, network call or live data. Facts follow ethereum.org transaction, gas and finality pages; fee example is arithmetic only.

### v0.2 DES-01 and BASE-01 (2026-10-23, stacked on unmerged PR #3)
- Added `docs/BASE-01_BASELINE.md`: recorded the actual repository and Cloudflare baseline, including failed docs-branch builds and unverified Functions/Access coverage.
- Added a shared mode marker (SIMULATED, LIVE · CACHED, LIVE · REFRESHED, STALE, INCOMPLETE) with text and symbol; the demo notice now uses it.
- Renamed navigation to Explore demo, Track an address and Learn DeFi. Added `/track`, an honest placeholder that reads no live data and sends nothing.
- Added a return link to https://solacapitalpartners.com/ in the header and footer (opens the marketing site; leaves the app).
- Added design tokens (spacing, motion, focus ring). No live data, dependencies, wallet access or deployment changes.

### v0.1.1 — static free-hosting preparation (2026-10-23)
- Configured Next.js static export and trailing-slash output for Cloudflare Pages Free.
- Added local static file server, exported-route checks, Cloudflare static security headers and access-wall runbook.
- Kept all real wallet, DeFi and backend functionality out of scope. No hosted deployment or DNS changes.


### v0.1.1 — protected preview preparation (2026-10-23)
- Added a Vercel hosting protection, private QA, access verification and rollback runbook.
- No hosted deployment, app functionality, wallet integrations, DNS or WordPress configuration has been changed.


### 2026-10-23 — Sola Lens v0.1 preview

- Added a pinned Next.js App Router, React, and TypeScript scaffold; responsive Sola navy/gold/violet welcome screen, navigation, and all APP-01 routes.
- Added beginner and experienced entry points, six learning modules and quizzes, wallet decision guide, network education, and a simulated Solana swap walkthrough.
- Added deterministic simulated portfolio, asset/position/risk views, exact-cent accounting, debt subtraction, receipt deduplication, and explicit unknown-price/coverage disclosures.
- Added optional browser-local lesson progress with clearing and blocked-storage fallback; loading, error, empty, and missing-page states.
- Added lint/typecheck/unit/build and desktop/mobile browser/accessibility CI checks, preview security headers, and implementation/source-review documentation.
- Updated README with executable setup and verification commands. No wallet integrations, real addresses, API providers, WordPress changes, DNS changes, deployments, or merges.

## 2026-10-22 — Documentation bootstrap

### Added

- Repository README linking to shared product and operations references.
- `SPEC.md` describing Sola Lens purpose, staged releases, user journeys, security boundaries and exclusions.
- `AGENTS.md` for consistent engineering and WordPress agent behavior.
- `docs/APP_SCOPE.md` and `docs/WORDPRESS_SCOPE.md` defining the two work lanes.
- `docs/OPERATIONS.md` documenting branch/review/release/rollback process.

### Not changed

- No WordPress content, DNS, running application, blockchain integrations, or production deployments.

### DATA-02 scaffold (2026-10-23, local branch, not released)
- Added Cloudflare Pages Functions `POST /api/v1/portfolio/resolve`, `GET /api/v1/health`, `GET /api/v1/networks` under `functions/api/v1/`, with server-only code in `server/portfolio/` and `public/_routes.json` limiting Functions to `/api/*`.
- Fixture provider only: every response is marked `mode: "mock"`, `simulated: true` and carries a SIMULATED warning. No blockchain is read, no provider, key or secret is used, nothing is stored.
- The API is off unless `PORTFOLIO_API_ENABLED` is `true`, and fails closed without a valid Cloudflare Access JWT (RS256 signature, issuer, audience, expiry). It adds no UI and the existing static pages are unchanged.
- Rollback: revert this commit group. Not deployed.
