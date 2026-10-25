# Sola Lens — v0.2 regression baseline (plan §10 Phase A.2)

Baseline: `51dbc7f` (live) on branch `v0.2-preview`. All suites green at baseline:
vitest 394/394 (29 files); Playwright e2e per spec below.

## Existing coverage mapped to the plan's required regression surface

| Plan surface | Coverage |
| --- | --- |
| ETH ERC-20 balances (ETH/USDC/USDT/DAI/WETH) | `live-provider.test.ts`, `portfolio.test.ts`, `portfolio-api.test.ts`, e2e `track.spec.ts`, `combined.spec.ts` |
| Aave V3 supplied/variable debt | `aave-v3.test.ts`, `aave-v3-read.test.ts`, `aave-model.test.ts`, `aave-live.test.ts`, e2e `aave-pixels.spec.ts` (long-magnitude no-wrap guard at 1280/390/320) |
| Solana SOL lookup | `live-provider-solana.test.ts`, `lookup-retry.test.ts` |
| Address persistence (D1) | `accounts.test.ts`, `accounts-client.test.ts`, `d1-adapter.test.ts`, e2e `accounts.spec.ts`, `local-d1-contract.spec.ts` (helpers/d1-sqlite) |
| Markets prices | `market-provider.test.ts`, `markets-dexscreener.test.ts`, `markets-decimal.test.ts`, `markets-handler.test.ts`, `markets-instruments.test.ts`, `markets-overview.test.ts`, e2e `markets.spec.ts` |
| Sign-out / session | `session-check.test.ts`, e2e `journeys.spec.ts` (sign-out navigates to Access logout, intercepted; keyboard focus order), `bfcache.spec.ts` |
| Failure honesty | `live-failure-drill.test.ts`, `aggregate.test.ts`, `combined-load.test.ts` |
| Security | `security-lab.test.ts`, `content.test.ts`, `copy-claims.test.ts` |

## Gaps to add during Phase B/C (tracked here, not blockers for auth design)
1. No test exercises two simultaneously authenticated users (cross-account isolation)
   — required by the plan's acceptance criteria; lands with native auth tests.
2. No SOL provider-fallback test across multiple endpoints (single-endpoint retry only).
3. Snapshot/history suites do not exist yet (no such feature); they arrive with the
   consented-snapshot work and must include duplicate-delivery, immutability and
   consent-withdrawal cases per the Isa valuation invariants.
4. Preview-environment e2e is not wired (no preview env vars yet); add a staging
   smoke job once preview vars exist.
