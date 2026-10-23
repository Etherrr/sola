# Changelog

Document **material, user-visible, architecture, security, or process changes**. Use dates and an Unreleased section. Do not record future work as completed.

## Unreleased

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
