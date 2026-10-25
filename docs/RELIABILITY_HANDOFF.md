# Reliability and source preparation — handoff, 2026-10-24

Branch: `feat/portfolio-reliability-accounts`. Baseline: `origin/feat/live-wallet-app` at `a63b465`. Local work only; not deployed, pushed or merged. `main` and the production release branch were not changed.

## Completed changes

- Track honors 429 Retry-After (seconds / HTTP date, 30-second invalid/missing fallback), blocks premature submission and offers an explicit retry. No background provider polling or automatic retry. Network switches abort the browser request and invalidate late results while preserving the cooldown.
- Reject unusable response timestamps and extra unrequested wallets. Show balance observation separately from response completion and each price-feed update. Solana's observation now uses balance-response receipt, not the Ethereum pricing block time. This is receipt time, not a Solana block timestamp.
- Markets UI has four source-pending areas with no values. Typed server provider interface plus a disabled implementation perform no vendor IO. No live market adapter or cache is implemented before source approval.
- Correct Settings/privacy copy; preserve one Education navigation exit, verified identity flow, entrance animation, reduced motion and clearly simulated Overview.
- Document account storage/isolation/deletion proposal and market candidate terms/coverage/costs. Owner explicitly chose to defer persistence and finish reliability/source preparation. No local or server address storage was added.

## Verification actually run

- `npx vitest run`: 242 passing tests (includes mocked upstream/auth failure paths, retry-header parsing, cancellation, extra-wallet rejection and independent observation clocks).
- `npx tsc --noEmit`: passed.
- ESLint on all changed JS/TS/TSX files: passed, zero warnings.
- `npm run build`: static export passed; `npm run verify:export`: 21 routes plus 404/headers verified.
- `npx playwright test`: 119 passed, one existing skipped test, desktop and iPhone Chromium emulation. New tests cover cooldown/no automatic requests, late response after network switch, unavailable market UI, and welcome animation/reduced motion. Existing verified identity expiry/replacement/fail-closed tests passed. Automated accessibility sweep includes Markets. No account CRUD/isolation implementation exists to test; its server authorization matrix remains a future acceptance gate.
- Desktop/mobile Markets, manual-retry, welcome curtain and reduced-motion screenshots inspected in `output/playwright/`. These contain no real account identity or live wallet data; retry uses a labeled synthetic fixture and API responses are mocked. Browser emulation is not real-device verification.
- `npm ci --ignore-scripts` restored the existing lockfile dependencies after the old checkout lacked jose; audit reported zero vulnerabilities. No package/lockfile change or new dependency.

The initial browser run found an existing ambiguous `getByLabel('Network')` locator (select and group). It now targets the combobox explicitly. The export allowlist now includes Markets. These failures were fixed before the passing run.

## Evidence and limitations

Visual files (local, ignored): `output/playwright/markets-desktop.png`, `markets-mobile.png`, `retry-desktop.png`, `retry-mobile.png`, `welcome-animation-desktop.png`, `welcome-animation-mobile.png`, `welcome-reduced-desktop.png`, `welcome-reduced-mobile.png`.

No genuine live lookup, production log access, Cloudflare binding inspection, flag change, deployment, Access change, DNS change or vendor integration was performed. Current production PORTFOLIO_LIVE_DATA value is unverified here. Reported Solana failure is consistent with rate limiting, not incident-log-confirmed. A green mock suite does not prove upstream availability. The UI cooldown is not a server rate limiter and can be bypassed by another client. Aborting the browser does not prove upstream cancellation. Existing PublicNode best-effort availability, coverage/price limits and Access revocation limitations remain.

## Review, dependencies and rollback

A GitHub open-PR inspection found overlapping historical stacks: PR 13 (entrance/session), PR 16 (live adapter), PR 17 (failure drill/runbook). This branch starts from the release source containing that work; do not merge those stacks blindly or overwrite another developer's new changes. Local review scope is retry/request ownership, observation clock correction, honest unavailable-market UI and docs. No messages were sent to other developers. Owner/designated reviewer still needs to coordinate concurrent ownership and review this diff against the latest release head before any merge.

External runtime dependencies remain existing Cloudflare Access/Pages and PublicNode/Chainlink. D1/KV and market vendors are proposals only. CoinGlass API terms require clarification/written permission for the intended display/redistribution; paid-tier labeling alone is insufficient. Geographic eligibility and complete liquidation coverage are not verified. See MARKET_SOURCES_REVIEW.md.

Rollback impact: reverting this change restores prior lookup UX and removes Markets/clock correction; no database migration, persistent account data, credentials or configuration must be undone. A code revert is not a hosting rollback. Preserve existing Cloudflare deployments and Access protection; deployment rollback is an owner-approved operation.

## Pending / next item

Owner review of the local branch is next. PR publication and any preview/release need a coordinated handoff; nothing was pushed in this change. Account persistence, account-scoped returning-user address lists and real Overview aggregation remain deferred. Before market integration: owner source choice, confirmed display rights/geography, credentials and cost approval, then schemas/bounded server fetch/cache and one approved real lookup. Before incident confirmation: authorized sanitized request-log correlation. No production release is authorized by these checks.
