# Sola Lens v0.2 - Live Observation & Immersive Learning
**Status:** Implementation plan; no app feature or deployment is authorized by this document alone.
**Owner:** Sola Capital | **As of:** 2026-10-23 | **Primary surface:** Cloudflare Pages / `Etherrr/sola`
**Read first:** `SPEC.md`, `AGENTS.md`, `docs/APP_SCOPE.md`, `docs/OPERATIONS.md`.

## 1. Objective and success definition
Evolve the protected static Sola Lens demo into (a) an engaging, accessible financial education portal and (b) a genuinely useful **read-only** portfolio viewer for **public Ethereum addresses**, followed by optional wallet account discovery and other networks. Do not trade polish for financial correctness or custody/security boundaries.

A successful initial live release lets a tester enter an Ethereum address, explicitly opt into a live lookup, view real supported wallet balances with timestamps, distinguish them from the demo, see warnings about unsupported DeFi positions, and return to the demo without any wallet signature, account creation, or payment.

**Product boundary:** Sola never asks for seed phrases, passphrases, private keys, login credentials to external wallets, signatures, approvals, deposits, swaps or transactions. An entered address is *observed*, not *verified as owned*. Live display is not a guarantee of completeness, price accuracy or financial advice.

## 2. Baseline and branch reconciliation (blocking prerequisite)
At preparation time, GitHub `main` contained the v0.1 demo; the static-export/Cloudflare work was on **open PR #3** (`chore/protected-preview-v0.1.1`). The user reports the Cloudflare-hosted offline demo is working; the actual Pages environment, production branch, current deployed commit, hostname protection and app configuration **must be inspected by the Cloudflare-authorized agent** rather than inferred.

**Before implementation, record** Pages project name, protected deployment URL (private), production and preview branches, deployed SHA, build command, `out` directory, framework/runtime and Access policy coverage. Reconcile PR #3 with `main` through the approved review process before branching live features. Confirm all reachable `pages.dev` / preview aliases and static assets are protected. Do not modify WordPress, DNS, production domain or external access rules without explicit approval.

## 3. Experience design: fewer click-throughs, more learning by doing
### Information architecture
- Keep three explicit entry points: **Explore Demo**, **Track an Address**, **Learn DeFi**. A disconnected user is not automatically a beginner.
- Preserve recognizable navigation across learn/demo/live sections. At every portfolio screen show a persistent mode marker: `SIMULATED`, `LIVE - CACHED`, `LIVE - REFRESHED`, `STALE` or `INCOMPLETE`.
- Use a Sola design system: deep navy foundation, muted gold highlights, selective violet motion, generous financial typography, restrained movement. Reuse existing approved WordPress/brand assets only after owner review.
- Never animate numeric values in a way that hides their source or implies market movement. Avoid fake equity/performance charts from one balance snapshot.

### Learning v0.2: build two interactive scenes first
1. **Network journey:** send a completely simulated transaction between *fictional* public addresses, show network, gas, confirmation status and block finality as an instructional animation. User can pause, scrub, replay, and read a text equivalent. This must not invoke a wallet.
2. **Security decision lab:** choose among a legitimate connection prompt, deceptive seed phrase prompt, unsafe allowance and suspicious domain. Reveal consequence and safer action in place, not on a separate quiz slide. Never ask users to type actual secrets.
3. **Later (v0.3):** interactive Jupiter/Solana swap quote sandbox and collateral/borrow health-factor sandbox using deterministic invented inputs and explicit SIMULATION labels. No live execution interface.

Design constraints: strong responsive charts, visual position breakdown, stateful progress without forced signup, microinteractions under reduced motion rules, keyboard + screen-reader equivalents, no mandatory video, heavy WebGL, or blocking animation. Track completion only if users opt into local persistence.

## 4. Live read-only scope in stages
| Gate | Deliverable | Excluded until later |
| --- | --- | --- |
| **v0.2.0** | Ethereum mainnet manual public-address lookup; native ETH + selected ERC-20 balances; validated prices where available; demo/live distinction; provider errors/coverage; upgraded dashboard | Wallet connection, Solana, general DeFi accounting, history/P&L |
| **v0.2.1** | EIP-6963 injected-wallet discovery and explicit user-triggered EVM **public-account read** (MetaMask first), address switching, disconnect, watch-only fallback | Signature methods, WalletConnect/multichain promises, hardware compatibility claims |
| **v0.2.2** | Solana public-address lookup **after** chain-specific validation and fixture tests; selected DeFi positions only after separate provider-protocol reconciliation | Universal Solana/LP/Aave/HF coverage |
| **v0.3** | Richer simulated DeFi labs, contextual learning, deeper analytics with proven inputs | Execution, custody, autopilot trading |

No release number overrides the acceptance/security gates. v0.2.0 can ship behind Access without v0.2.1.

### v0.2.0 UI requirements
- Address form: choose Ethereum, paste address, validate checksum/length, show clear errors and privacy notice. One or a strictly bounded number of addresses initially; do not infer ownership.
- Live dashboard: assets, detected token quantities, source-backed prices (nullable), recognized asset subtotal, unpriced count, last updated, chain, provider coverage and operational status.
- When only wallet balances are supported, label explicitly: **"Wallet balances only: DeFi deposits, staking, debts, LP claims and other positions may be missing; the subtotal is not total net worth."**
- Missing price is **Unknown**, not zero. Empty wallet is valid; missing provider data is not an empty wallet. Spam/scam tokens may be untrusted, flagged or omitted with a disclosure.
- Every value remains traceable to `chainId + contract/native ID + source + observedAt`; symbols alone cannot identify assets. Do not double count positions or mislabel debt as an asset.
- Never replace a failed live request with simulated data. Have independent `Demo` and `Live` views with obvious route/state changes and safe refresh behavior.

## 5. Cloudflare technical architecture
Keep the existing **Next.js static export** for the frontend and add narrowly scoped **Cloudflare Pages Functions** for live endpoints, initially under `functions/api/v1/`. Do not convert the site to Node/SSR as a shortcut.

```
Browser: static Next.js UI (demo or live mode)
          |
          | POST /api/v1/portfolio/resolve (public address only)
          v
Cloudflare Pages Function: input validation, limits, caching, errors
          |
          | Server-side secret(s), outbound HTTPS
          v
One evaluated chain/indexing/price provider
          |
          v
Normalized response -> safe UI with coverage/freshness labels
```

- Add `functions/api/v1/portfolio/resolve.ts`, `functions/api/v1/health.ts`, `functions/api/v1/networks.ts` only when approved for implementation. A `GET` endpoint must **never** expose provider secrets or private infrastructure metadata.
- Preserve `output: 'export'` and static `out` output. For `functions/` introduce and verify `_routes.json` under build output so only `/api/*` invokes Functions; other static requests must stay free/static.
- Secrets go into Cloudflare **encrypted environment secrets**, not source, Pages build output, GitHub issues or browser bundle. Evaluate provider contract/licensing/quotas/availability before choosing. No mandatory database for v0.2.0.
- Browser should not call paid/indexer endpoints directly with secret keys. Validate size and schema on both request and external response. Support abort/timeout, bounded concurrency, retry with backoff for retryable failures only, and separate cache age from fetched time.
- Use a defensible free-tier abuse/rate-limit mechanism at the edge. In-memory per-instance counters alone are not adequate. Consider provider quota, Cloudflare rules and user-friendly capped refresh behavior; disclose when robust limits require an upgrade.
- Cloudflare Pages Function request quota is shared with Workers Free usage. Set monitoring and cost caps/alerts and keep a kill-switch for the live feature.
- Initial feature flags: `livePortfolioEnabled=false` until QA, `evmWalletDiscoveryEnabled=false`, `solanaEnabled=false`, `protocolPositionsEnabled=false`; flags must not bypass server-side access controls.
- Existing site authorization stays at the Cloudflare Access layer for protected beta. Verify Access covers Functions **as well as** assets, preview and production hostnames. `noindex` is not access control.
- Leave WordPress `solacapitalpartners.com` and future `app.solacapitalpartners.com` DNS unchanged until approved.

## 6. Provider evaluation - mandatory before external API code
Compare at least **two** candidate data paths (e.g. Alchemy, Moralis, Zerion, direct RPC + pricing) against a fixed worksheet:
- Supported EVM networks and exact balance methods; native vs ERC-20; token metadata and spam behavior.
- Coverage of **specific** DeFi protocols and position types (do not assume a marketing "DeFi API" is comprehensive).
- Price source, timestamp, token identifiers and treatment of illiquid tokens.
- Free credits, daily/second limits, commercial licensing, billing and alerts.
- API response latency, error states and provider outages.
- Address-sharing/privacy terms and retention.
- Sample wallet reconciliation: empty, native-only, mixed ERC-20, spam, an Aave supply/borrow, an LP receipt, unknown token price, and an address with many token contracts. Test fixtures may use authorized public test addresses; do not publish a private user's activity.

Output: `docs/PROVIDER_EVALUATION.md` with **chosen** provider, rejected options, exact checked date, known omissions and a cost fallback. Do not integrate a provider before this review is accepted.

## 7. Minimum request/response contract
`POST /api/v1/portfolio/resolve` accepts a bounded object containing `network: "ethereum"`, `addresses: string[]` (max 5 initially), and `currency: "USD"`. Validate bytes, array size, address checksum and network allowlist. Do not allow arbitrary RPC URLs or contract call methods from clients. Return 400/413 for invalid inputs, 429 for limits, controlled 502/503/504 for provider failures.

Every successful response:
- `schemaVersion`, `requestId`, `generatedAt`, `observedAt`, `provider`, `chainId`, `mode: "live"`.
- `assets[]`: canonical `assetId` (chain-qualified address/native designation), decimals, precise integer-unit amount as string, normalized decimal amount string, price string or null, value string or null, priceSource and priceObservedAt if known.
- `totals`: recognized priced subtotal string or null; unpriced asset count; coverage/limitations; **not** a guaranteed wallet or net-worth total.
- `warnings[]` and `partial: boolean`. Make source timestamps and discrepancies visible; do not invent `apy`, cost basis, P&L, trends or liquidation metrics.

Represent token units with `bigint` and decimal-string/decimal arithmetic; never use ordinary JS floating point as the canonical financial accounting representation.

## 8. v0.2.1 MetaMask / wallet address discovery
A wallet is only a **public address discovery convenience**, not the source of balances.
- Use EIP-6963 for injected wallet selection; fall back carefully when only legacy EIP-1193 is available.
- On deliberate click only, allow `eth_requestAccounts` (and read-only `eth_accounts`, `eth_chainId` as needed). Confirm selected account and chain; handle `accountsChanged`, `chainChanged`, rejection, lock, disconnect and multiple wallets.
- Hard-block `personal_sign`, `eth_sign`, `eth_signTypedData*`, `eth_sendTransaction`, `wallet_sendCalls`, token approvals, chain switching and any other transaction/signing path. Add automated negative tests.
- Do not auto-open permission prompts or claim compatibility with NuFi, Ledger or OneKey before a versioned device/browser matrix is tested.
- On mobile or unsupported browsers, preserve manual public-address entry. Never force wallet setup to see a portfolio.
- Optional locally saved watch-only addresses require explicit opt-in, local clear/reset and a privacy notice; wallet connection does not prove ownership of arbitrary pasted addresses.

## 9. Quality, privacy and launch gates
**Engineering tests:** schema validity, invalid EVM address, ENS unsupported message (unless separately scoped), zero-wallet, duplicate address, API failure, timeout, 429, stale cache, unknown price, spam token, odd decimals and very large quantities; no overflow and no duplicate exposures. Verify asset ID matching across networks and all monetary math.

**Security:** no keys in static bundle; denylist/restricted interface for signing; locked-down Cloudflare secrets, Access policies, external link allowlist, no full wallet address histories in analytics/logs, CSP and dependency review, origin/CORS/CSRF threat model appropriate to a public read-only endpoint, abuse limits and provider usage monitoring. Review redacted request logging and retention.

**Experience:** realistic 320px mobile reflow; keyboard navigation, screen-reader equivalent to animations, reduced motion, no intrusive motion, WCAG 2.2 AA target, browser tests and real iOS/Android/Safari manual pass. Performance should not degrade significantly versus v0.1; no large blocking animation bundles.

**Release:** staging URL protected, CI green, Cloudflare build and Functions correctly configured, unauthorized probe (including deep links and API) denied, authenticated smoke test, financial fixture reconciliation, product copy/privacy reviewed, cost thresholds configured, owner signoff, rollback/kill-switch tested. Keep WordPress launch disabled.

## 10. Agent ticket sequence and commit boundaries
| Ticket | Scope | Exit gate |
| --- | --- | --- |
| **BASE-01** | Inspect deployed Cloudflare app/branch, reconcile PR #3/main and access controls | Deployed SHA, branch, build, protected URLs documented |
| **DES-01** | UI design tokens, polished shell and mode switch | Consistent DEMO/LIVE labels; visual QA |
| **EDU-01** | Interactive network scene with pause/replay and text fallback | Full keyboard/reduced-motion tests |
| **EDU-02** | Security decision lab and local-state mechanics | No secret entry or wallet prompts |
| **DATA-01** | Provider evaluation and approved data contract | Owner selects low-cost provider with known limitations |
| **DATA-02** | Cloudflare Pages Function scaffolding, `_routes.json`, validation and mock provider | No exposed secrets; mock contract tests and protection |
| **DATA-03** | Real Ethereum address lookup and live dashboard | End-to-end reconciliation + failure testing |
| **WAL-01** | Optional MetaMask/EIP-6963 address discovery | Separate security-reviewed PR; no signatures |
| **CHAIN-01** | Solana and selected protocol positions | Per-chain/protocol reconciliation + coverage notice |
| **OPS-01** | Monitoring, documentation, rollback and protected beta check | Owner-approved release notes and QA results |

Each ticket is a separate, reviewable PR or tightly grouped PR with real test results. Build **DES/EDU** and **DATA-01** in parallel if convenient, but merge DATA-02 only after security/provider review.

## 11. Required operational handoff for each PR
Every engineering PR must include **changed routes and files**, before/after screenshots for UX work, test command outputs, Cloudflare preview link (not bypass tokens), deployed vs expected commit, new dependencies/costs, data limitations, privacy impact, rollback, and next tickets. Maintain `CHANGELOG.md` as the single changelog. Never represent unbuilt features as complete.

## 12. First assignment to the Cloudflare-enabled coding agent
1. Inspect repo `main`, PR #3, and the currently deployed Cloudflare Pages project. Record status accurately; do not assume the deployed branch is `main`.
2. Preserve Cloudflare Access and the existing fully simulated app; do not deploy live data in this first PR.
3. Create issues/subtasks for **BASE-01, DES-01, EDU-01, EDU-02 and DATA-01**.
4. Complete **BASE-01**, then implement **DES-01** and one polished interactive education scene on a new branch; produce protected screenshots and manual mobile QA notes.
5. In parallel, research two read-only Ethereum data providers with exact cost/free limits and build a validated data contract, without keys in Git or live API requests from the browser.
6. Submit a PR and stop for approval before any production release, new provider credential, wallet permission request or live API rollout.

**No WordPress changes. No trading/signing. No blind deployment. Keep initial operating costs near $0 and document any upgrade requirement before activation.**

## 13. Reference documents (verify again during build)
- Cloudflare Pages Git integration: https://developers.cloudflare.com/pages/configuration/git-integration/
- Next.js static export on Pages: https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/
- Cloudflare Pages Functions: https://developers.cloudflare.com/pages/functions/get-started/
- Pages Functions routing: https://developers.cloudflare.com/pages/functions/routing/
- Pages Function secrets: https://developers.cloudflare.com/pages/functions/bindings/
- Pages Functions pricing: https://developers.cloudflare.com/pages/functions/pricing/
- EIP-6963: https://eips.ethereum.org/EIPS/eip-6963
- MetaMask Connect: https://docs.metamask.io/metamask-connect/
