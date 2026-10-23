# Sola — Sola Capital & Sola Lens

This repository is the shared **engineering handoff and future source-code home** for Sola Lens, the proposed read-only DeFi portfolio and learning web application.

**Status (2026-10-22): documentation-only bootstrap.** No application, wallet integration, API, or deployment has been implemented by this commit.

## Two separate products

| Surface | Role | Owner lane |
| --- | --- | --- |
| [solacapitalpartners.com](https://solacapitalpartners.com) | Existing WordPress corporate, markets, insights, and projects website | WordPress agent |
| `app.solacapitalpartners.com` | Proposed standalone Sola Lens onboarding, learning, and read-only portfolio app | Web-app/GitHub agent |

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
- **WordPress V3.0:** independent research-led site release; Sola Lens is described as *In Development* and its launch flag remains off until app approval.

## Rules of engagement

- No seed phrases, private keys, passphrases, trading, signing, custody, or deposits.
- No fake live data, fabricated credentials, false claims, or backdated publications.
- Preserve the existing WordPress website; do not iframe the app.
- No secrets or private user data in repository issues, code, logs, or examples.
- Scope changes require updated docs and `CHANGELOG.md`.
- Once initialized, implement features in small branches and PRs; no automatic production releases.

The repository will gain development scripts and setup commands when the actual web application is scaffolded. Do not copy imagined commands into this README beforehand.
