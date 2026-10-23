# Sola Lens — Product Specification
**Version:** 0.1 | **Status:** proposed | **Updated:** 2026-10-22

## Goal
Sola Lens is an independently deployed, **read-only, non-custodial** DeFi learning and portfolio-intelligence web app. It should allow a first-time visitor to learn safely and an experienced visitor to view supported on-chain positions quickly. It does not manage capital.

## Surfaces
- **WordPress (solacapitalpartners.com):** public company pages, markets, insights, research, Projects/Sola Lens status, contact; preserves the separate V2.3→V3.0 public-site roadmap.
- **Sola Lens (proposed app.solacapitalpartners.com):** onboarding, learning, address-based observation, optional public-account wallet discovery and analytics. Separate code, host, runtime and sessions.

## Required journeys
1. **Experienced:** open portal → choose public-address entry or (later) wallet account discovery → validate network/address → show supported assets, debt and protocol positions, timestamps and warnings. No signature required.
2. **Newcomer:** choose Intro to DeFi → blockchain/network concepts → software/hardware-wallet decision guide (MetaMask, NuFi, OneKey, Ledger as candidates, not endorsements) → seed/key, phishing, approvals and privacy lessons → simulated portfolio and swap walkthrough → optional live watch-only portfolio → contextual Solana/Jupiter, EVM, lending and LP education.
3. **Demo:** deterministic **SIMULATED** sample portfolio, no real credentials or API calls.
4. **Returning:** user may skip tutorials; optional onboarding progress and address labels stored locally with clear/delete controls. Disconnected does **not** imply inexperienced.

## UX principles
- Premium restrained Sola navy/gold/violet design; mobile-first, accessible, reduced-motion support.
- Show back/skip/exit throughout onboarding; no signup, wallet purchase or deposits required.
- Explain public address vs ownership and connection vs signing.
- Curated protocol links point to vetted official websites and clearly identify third parties.
- Always mark live/cached/stale/incomplete/unpriced/simulated states clearly.

## Initial releases
| Gate | Deliverable | Exit condition |
| --- | --- | --- |
| v0.1 preview | app shell, welcome, learning, wallet selector, quizzes, demo | demo explicitly simulated; mobile and keyboard QA; no wallet libraries needed |
| v0.2 watch-only beta | Ethereum + Solana public-address validation, provider adapters, balances and selected DeFi positions | reconciled fixture results, price/debt correctness, rate limits, failure states and provider disclosures |
| v0.3 optional connectivity | public-account discovery from supported providers, expanded risk and contextual lessons | no signing or transactions; wallet compatibility matrix; security review |
| v1.0 launch | resilient hosted app and approved WordPress launcher | owner accepts privacy, legal, reliability, security, design, rollback and monitoring gates |

No release date, API vendor, or wallet compatibility should be assumed until tested.

## Explicit exclusions
Trading, swaps, transaction simulation presented as real, approvals, signatures, private-key or seed-phrase entry, custody, user deposits, managed accounts, investor onboarding, personalized financial advice, performance guarantees, comprehensive tax reporting and universal protocol coverage.

## Metrics and quality gates
- Desktop/mobile responsive, accessible instructional alternatives and keyboard navigation.
- Valid empty portfolio handled; duplicate addresses deduplicated; missing prices shown unknown not $0; borrow positions treated as liabilities; LP holdings not double counted.
- All data includes source/observation time and coverage; partial outages do not show misleading totals.
- No production WordPress or DNS change until independently authorized.
- Changes to scope are logged in CHANGELOG.md.
