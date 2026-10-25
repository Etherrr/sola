# Sola — Sola Capital & Sola Lens

This repository is the shared **engineering handoff and source-code home** for Sola Lens, the proposed read-only DeFi portfolio and learning web application.

**Source status (2026-10-24):** static-export Next.js app with Cloudflare Pages Functions, Access-verified identity, and read-only Ethereum/Solana lookup adapters. Overview remains simulated. Live lookup mode requires the exact server flag `PORTFOLIO_LIVE_DATA=1`; this does not confirm current production settings. Account persistence was described as deferred in the 2026-10-24 handoff documents; no owner-channel confirmation of that deferral has been found, and the roadmap request for account tracking stands. Markets is source-pending with no figures. See the [live runbook](docs/LIVE_DATA_RUNBOOK.md), [account proposal](docs/PORTFOLIO_ACCOUNTS_DESIGN.md) and [market review](docs/MARKET_SOURCES_REVIEW.md).

## Two separate products

| Surface                                                    | Role                                                                                     | Owner lane           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------- |
| [solacapitalpartners.com](https://solacapitalpartners.com) | Existing WordPress corporate, markets, insights, and projects website                    | WordPress agent      |
| `app.solacapitalpartners.com`                              | Protected-preview standalone Sola Lens onboarding, learning, and read-only portfolio app | Web-app/GitHub agent |

The domain remains managed through WordPress. The proposed `app` subdomain may point to a separate host after approval. **Do not change live DNS or enable the WordPress launch link during documentation/setup.**

## Start here

1. [SPEC.md](SPEC.md) — product purpose, scope, user journeys, exclusions and release gates (**product source of truth**).
2. [AGENTS.md](AGENTS.md) — mandatory operating rules for both agents.
3. [docs/APP_SCOPE.md](docs/APP_SCOPE.md) — Sola Lens engineering and acceptance criteria.
4. [docs/WORDPRESS_SCOPE.md](docs/WORDPRESS_SCOPE.md) — public-site responsibilities and launch-link contract.
5. [docs/OPERATIONS.md](docs/OPERATIONS.md) — branches, reviews, testing, deployment and rollback.
6. [CHANGELOG.md](CHANGELOG.md) — recorded material changes.

## Proposed delivery sequence

- **App v0.1 — Preview:** branded navigation, two user paths, guided wallet/security learning and clearly labeled demo portfolio.
- **App v0.2 — Watch-only beta:** real public-address lookup, Ethereum/Solana coverage with tested provider adapters, transparent incomplete-data states.
- **App v0.3 — Connections & analysis:** optional public-account discovery, supported DeFi positions and risk analytics; no signing.
- **App v1.0 — Public launch:** only after technical, editorial, privacy and owner review.
- **WordPress V3.0:** independent research-led site release; Sola Lens is described as _In Development_ and its launch flag remains off until app approval.

## Rules of engagement

- No seed phrases, private keys, passphrases, trading, signing, custody, or deposits.
- No fake live data, fabricated credentials, false claims, or backdated publications.
- Preserve the existing WordPress website; do not iframe the app.
- No secrets or private user data in repository issues, code, logs, or examples.
- Scope changes require updated docs and `CHANGELOG.md`.
- Once initialized, implement features in small branches and PRs; no automatic production releases.

## Local development

Use Node.js 24 LTS and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. For the exported static local preview, run `npm run build` then `npm run start`. The static server binds only to loopback by default. No environment variables, provider credentials, database, or wallet extension are required for the local simulated preview. The loopback static server has no Pages Functions; API/session browser tests use explicit mocks.

```sh
npm run check                 # lint, typecheck, unit tests, production build
npx playwright install chromium
npm run test:e2e              # desktop + mobile Chromium against production build
npx prettier --check app components features content lib tests
npm audit
```

Browser tests start the local static-export server if one is not already running. CI installs Chromium and runs the same checks. The production release branch `feat/live-wallet-app` auto-deploys; never push to it without owner approval. Work on a separate feature branch. Do not infer hosting configuration from local tests.

## Preview features

- Welcome screen with beginner, experienced, and demo entry points.
- Six modules with knowledge checks; wallet decision guide; network field notes; simulated swap walkthrough.
- Simulated assets, DeFi positions, and risk views. Every portfolio view carries a SIMULATED notice, fixed fixture reference, coverage limits, and unknown-price warning.
- Opt-in browser-local lesson progress and clear controls in Settings; no analytics or user accounts.
- All routes in [APP_SCOPE](docs/APP_SCOPE.md) plus `/learn/addresses` and `/learn/risks`.

For the **free static preview**, use [Cloudflare Pages deployment and access guidance](docs/CLOUDFLARE_PREVIEW.md). The earlier [Vercel plan](docs/PROTECTED_PREVIEW.md) is retained for reference but is not the selected free-testing path. No protected deployment has been verified.

See [implementation notes](docs/IMPLEMENTATION.md) for architecture, provisional design tokens, dependency licenses, privacy, checks, limitations, and rollback. Hosted preview access control and owner review are separate gates; this change does not deploy or activate the WordPress launch link.
