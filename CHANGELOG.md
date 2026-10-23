# Changelog

Document **material, user-visible, architecture, security, or process changes**. Use dates and an Unreleased section. Do not record future work as completed.

## Unreleased

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

## 2026-10-23 — v0.2 implementation scope (documentation only)

- Added `docs/V0_2_BUILD_SCOPE.md` detailing immersive onboarding, staged live Ethereum public-address tracking, later MetaMask discovery and Solana positions, Cloudflare Pages Functions, financial data validation, security and release gates.
- Linked the staged plan from README, SPEC, APP_SCOPE and AGENTS. No application code, wallet connections, credentials, Cloudflare deployments, WordPress site or DNS were changed by this documentation update.
