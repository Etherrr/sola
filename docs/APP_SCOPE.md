# Web-app / GitHub Agent — Implementation Scope

Refer to [../SPEC.md](../SPEC.md) for product decisions and [../AGENTS.md](../AGENTS.md) for mandatory guardrails. Host planned at `app.solacapitalpartners.com`, independently of WordPress.

## Architecture (keep simple)
- Next.js App Router + React + TypeScript, maintained stable versions at implementation time; accessible component primitives and Sola design tokens.
- One repository and app with server-side API route handlers; no microservices or database in v0.1.
- Proposed modules: `app/` routes, `components/`, `features/onboarding/`, `features/portfolio/`, `lib/providers/`, `lib/normalize/`, `content/lessons/`, `tests/`.
- GitHub Actions lint/typecheck/tests/build and protected preview deployment.
- Server-side provider credentials and rate limiting when live APIs arrive. Client must not access provider secrets.

## Work packages
### APP-01: scaffold and UX (v0.1 preview)
- Welcome with experienced/new/demo paths, accessible mobile nav, shared branded components, error/empty/loading states.
- Routes: `/`, `/start`, `/start/wallets`, `/start/security`, `/start/networks`, `/start/defi`, `/connect`, `/portfolio`, `/portfolio/assets`, `/portfolio/positions`, `/portfolio/risk`, `/explore`, `/learn`, `/settings`.
- Six educational modules: blockchain basics, wallet choice, security, address/portfolio basics, simulated Jupiter/Solana swap education, lending/staking/liquidity risks.
- Wallet decision guide distinguishes software interface from hardware key storage; link only to vetted official destinations, review versions.
- Quizzes that NEVER solicit real secrets. Browser-local optional progress, clearing controls.
- Deterministic sample portfolio with permanent SIMULATED marker. No real wallet connection or public address API in v0.1.

**Accept:** all routes work in preview; mobile, keyboard and reduced-motion behavior verified; no wallet permissions or signing.

### APP-02: live watch-only lookup (v0.2)
- Chain-qualified address parser: Ethereum EVM and Solana. Reject malformed input and deduplicate same chain/address.
- Versioned `POST /api/v1/portfolio/resolve` accepting bounded chain/address pairs; `GET /api/v1/networks`, `GET /api/v1/health`.
- Provider adapter interface independent of vendor; evaluate vendor coverage and terms with real *non-sensitive* fixture addresses before selecting.
- Normalize amounts via integer/decimal-safe arithmetic and chain-specific token IDs (contract/mint, never symbol alone).
- Separate wallet assets, supplied collateral, debt, receipt tokens, LP constituents. Avoid counting same economic exposure twice.
- Calculate supported assets, debt, net supported value, allocation by asset/network/protocol; don't fabricate cost basis, APY or historic P&L.
- Return source, observation timestamp, cache freshness, position confidence, incomplete/missing-price warnings.
- Server-side request validation, timeouts, bounded concurrency, caching, retry discipline, rate limits and partial failure response.
- Privacy disclosure regarding addresses sent to RPC/indexing providers.

**Accept:** deterministic reconciliation tests, valid empty accounts, duplicates, LP receipts, lending liabilities, stale/missing prices and provider outages pass; never show unknown value as zero.

### APP-03: optional public-account discovery and analytics (v0.3)
- Optional wallet connectors for supported browser/mobile providers and network/account discovery only; no signing or transactions.
- Evaluate MetaMask, NuFi and hardware companions (OneKey/Ledger) individually; compatibility matrix by browser, device, chain.
- Risk views: allocation, concentration, borrowed debt, source-specific protocol health factors only when reliably supplied.
- Contextual learn links with vetted protocol URLs; optional position-group labels.

**Accept:** public-account-only permission boundary verified in tests, connector dependency review completed, supported cases manually tested, no unsupported wallet claims.

### APP-04: production readiness
- Accessibility (WCAG 2.2 AA target), mobile QA, error boundaries, CSP, dependency audit, threat model and protected secret handling.
- Logs without full unnecessary address history, health checks, costs, provider failures, uptime and rollback.
- Privacy/terms/security/content review and owner go/no-go. WordPress launch flag turned on only afterwards.

## Data contract minimum
Every normalized position needs: chain ID, normalized public address, provider/source, source position ID, protocol ID, position type, canonical asset ID, precise raw and displayed quantity, price/source/time (if available), value (nullable), liability direction, accounting/deduplication key, observed time, and warnings. Response needs: generated time, per-chain coverage, partial errors, source freshness and totals explicitly labeled supported/estimated.

## Non-goals
No wallets created or recovered by Sola; no trading; no mandatory user login; no external client deposits; no guarantees of universal protocol coverage. New functionality requires updated SPEC and owner review.
