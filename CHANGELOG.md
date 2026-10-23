# Changelog

Document **material, user-visible, architecture, security, or process changes**. Use dates and an Unreleased section. Do not record future work as completed.

## Unreleased

### v0.2 DATA-01 provider evaluation (2026-10-23, docs only, stacked on unmerged PR #3)
- Added `docs/PROVIDER_EVALUATION.md` comparing Alchemy, Zerion and direct RPC plus CoinGecko Demo from public documentation and keyless public calls. No provider is selected or integrated, no keys or accounts were created, and the sample-wallet reconciliation is recorded as incomplete.

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
