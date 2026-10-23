# Sola Lens v0.1 implementation

Scope: APP-01 in `APP_SCOPE.md`; tracks [issue #1](https://github.com/Etherrr/sola/issues/1). SPEC remains the product source of truth. This is a local simulated preview, pending owner review.

## Architecture

- Next.js App Router with React server-rendered routes and strict TypeScript. No database, API routes, authentication, provider SDKs, wallet libraries, or real addresses.
- `components/`: branded navigation, notices, and shared page/button components.
- `features/onboarding/`: quizzes, guide, walkthrough, learning library, and optional local progress using a subscribed browser store. Server rendering always starts from the same empty snapshot.
- `content/lessons/`: six typed modules, questions, feedback, and navigation order.
- `features/portfolio/`: fixture, exact integer-cent accounting, allocation, holdings, and dashboard views. Fixture IDs are explicitly simulated, not real token contracts/mints.
- `lib/`: defensive local-progress parsing and reviewed external links.
- `tests/`: accounting/content/boundary tests; desktop and mobile Chromium journeys with axe checks.

Money never passes through floating-point arithmetic. Debt is represented with a direction, values are nonnegative exact cents, and net value subtracts debt. Duplicate exposure IDs and receipt tokens are excluded. Unknown price remains `null`, renders as Unknown, and makes totals incomplete. Allocation uses gross priced assets, excluding debt, receipts, and unknown prices. No APY, historical P&L, cost basis, or protocol health score is inferred. This fixture is not a live normalization/provider contract; v0.2 still requires validated adapters and the full APP-02 data contract.

## Design

Repository guidance specifies premium navy/gold/violet but supplies no approved logo or token file. The following provisional implementation tokens are centralized in `app/globals.css`: navy `#0b1323`, deep navy `#080f1c`, gold `#d9bd7c`, violet `#aa9ee0`, text `#f2f1ee`. System sans-serif and Georgia avoid external font requests. The text wordmark and simple typographic S emblem require owner brand review; they are not represented as approved corporate logo assets.

Layouts use mobile navigation, single-column mobile cards, a contained horizontally scrollable holdings table, visible keyboard focus, a skip link, live quiz feedback, native form controls, and reduced-motion overrides. Automated checks are evidence, not a claim of full WCAG conformance. Manual screen-reader and Safari/Firefox/device QA remain launch work.

## Content and external links

Sources reviewed on 2026-10-23; review date is not a certification of safety or compatibility. Candidate wallets are not endorsements. The guide distinguishes software interfaces from hardware key storage and makes no device/network/version compatibility claims. No downloads, wallet purchase, or account creation are needed.

| Official destination           | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| https://metamask.io/           | Software wallet candidate                                     |
| https://nu.fi/                 | Software wallet candidate                                     |
| https://onekey.so/             | Hardware/software candidate                                   |
| https://www.ledger.com/        | Hardware/companion candidate                                  |
| https://jup.ag/                | Solana swap education context                                 |
| https://ethereum.org/security/ | Recovery material, phishing, approvals, and privacy reference |

External links are ordinary HTTPS links marked as third parties and use `noopener noreferrer`. Their domains were checked directly; exact current products and compatibility must be reviewed with vendors before future integration. Educational copy is authored for this preview. The sample quote of 1 SOL = 150 USDC is invented arithmetic, not a market quote.

## Dependencies, cost, and privacy

The only runtime packages are Next.js (MIT), React (MIT), and React DOM (MIT). Development tools include TypeScript (Apache-2.0), ESLint and typescript-eslint (MIT), Vitest (MIT), Prettier (MIT), Playwright (Apache-2.0), and axe-core/Playwright (MPL-2.0); preserve upstream license notices. There are no paid services, provider costs, hosted fonts, or analytics. GitHub Actions usage is subject to the owner's existing plan and limits.

TypeScript is pinned to 6.0.3 because typescript-eslint 8.72.0 does not support TypeScript 7 yet. ESLint 10 with TypeScript and React hooks rules avoids the Next ESLint package's currently affected braces dependency; browser axe checks cover rendered accessibility. Versions are locked, with no forced peer resolutions or advisory suppressions.

Progress saving is off by default and persists only completed lesson IDs under `sola-lens.progress.v1`. Turning it off or clearing removes that key; failures explain how to clear browser site data. Stored values are treated as untrusted and filtered. Progress is not transmitted. App hosting necessarily receives page requests; external destinations have separate privacy practices. No recovery material, address, or credential fields exist.

Preview headers restrict connections to the same origin, deny framing, disable camera/microphone/geolocation, prevent MIME sniffing, suppress referrers, and request no indexing. The CSP allows inline framework scripts/styles; nonce/hash hardening remains production work. Noindex is not access control. A hosted preview must be separately protected by the hosting platform before any deployment. No preview or production hosting, DNS, WordPress, or launch-flag changes are included here.

## Verification and remaining gates

Commands: `npm run check`, `npm run test:e2e`, and `npm audit`. Browser tests run the production build, all 16 public routes, keyboard/mobile navigation, reduced motion, quizzes, optional persistence/clearing, blocked storage, headers, forbidden signing surfaces, missing-page behavior, and absence of external exercise requests. Unit tests cover empty holdings, exact large values, negative net value, missing prices, duplicate exposures/LP receipts, network allocation, malformed saved state, lesson structure, official-link allowlist, and the absence of wallet SDKs/signing operations.

Loading and error components provide recovery without financial claims. The holdings table includes an empty state; there are no provider outage states because there is no provider. Full provider reconciliation, live network/address validation, and connectivity security tests belong to later releases.

Owner review is required for brand fidelity, editorial accuracy, privacy/legal language, and acceptance. Full manual assistive-technology QA and cross-browser/device tests remain open. Hosting protections, a stricter CSP, monitoring, dependency review, and release/rollback verification remain production gates. Do not deploy or merge this PR without approval.

### Verified locally on 2026-10-23

- `npm run check`: passed lint, route generation/typecheck, 10 unit tests, and Next.js production build (all 16 public routes prerendered).
- `npm run test:e2e`: 16 passed across desktop and mobile Chromium. All 16 routes passed automated axe checks; key views also passed 320/768/1024px reflow. Keyboard, reduced motion, persistence/clearing, blocked storage, no external exercise requests, and preview headers passed.
- `npm run format:check` and `git diff --check`: passed.
- `npm audit` and `npm audit --omit=dev`: zero vulnerabilities reported after removing the affected development lint dependency.
- Codex in-app browser visual inspection: welcome and portfolio on desktop, welcome at narrow width. Desktop/mobile welcome and portfolio screenshots are generated in ignored `output/playwright/` and uploaded by CI for review.

These are local results; remote GitHub Actions status is reported in the PR independently. No hosted preview or production deployment was performed.

## Rollback and next work

This PR creates no external runtime or data migration. Rollback is to close the unmerged PR or revert its commit after an approved merge; local saved progress can be cleared in Settings or browser site data. WordPress remains unaffected. Next work: owner APP-01 review and an explicitly authorized protected preview; APP-02 live lookup requires a separate scoped issue/PR and provider/privacy review.
