# Sola Lens — v0.2 repository assessment (plan §12.1)

Baseline: `51dbc7f` on `feat/live-wallet-app` (live), branch `v0.2-preview`.
Verified 2026-10-25 by direct code inspection + `vitest` 394/394 (29 files).

## Actual stack
- Next.js 16.4.2 App Router, static export (`output: export`), React 19.3.1, strict TypeScript 6.0.3.
- Hosting: Cloudflare Pages, one project serving `app.solacapitalpartners.com` and
  `sola-lens-preview.pages.dev`. No Workers service; server logic lives in Pages
  Functions under `functions/api/v1/*` backed by `server/*` modules.
- API endpoints (6): `health`, `session`, `portfolio/resolve`, `portfolio/accounts`,
  `markets/overview`, `networks`.
- Auth library: `jose` 6.2.13 verifies the Cloudflare Access JWT
  (`cf-access-jwt-assertion` header) against the team domain; owner keys for storage
  derive from the JWT issuer/subject (`server/portfolio/access.ts`, `accounts/handler.ts`).
- Tests: vitest 394/394 green at baseline; Playwright e2e incl. axe a11y and
  pixel-verification specs; `npm run check` = lint + typecheck + test + build + export verify.

## Authentication today (the P0 gap)
- Sole customer-facing auth is the Cloudflare Access hosted page (email one-time code).
  `handleSession` reports `{ via: 'cloudflare-access', identity: { email } }`.
- No native sign-in, no passkeys, no wallet connection, no SIWE/SIWS, no account creation
  inside the app. `/onboarding` is an explicitly non-functional visual prototype.
- Plan deviation: "one native Sola interface" is unbuilt; cutover must be staged
  (plan §3 constraints) and Access must keep protecting admin/staging.

## Data today
- Cloudflare D1, one binding; migration `0001_accounts_and_counters.sql`:
  `tracked_addresses (owner_issuer_subject, network, address, label, created/updated)` and
  `rate_counters`. Every D1 statement carries the owner predicate (deny-by-default at
  the store layer, `server/accounts/d1.ts`).
- No users/auth_identities/wallet_links/portfolios/snapshot tables — the §4 logical
  model is almost entirely unbuilt. No history/snapshot storage; no time series.
- Single shared production D1; **no staging database exists yet** (authorized: create
  isolated preview D1 before any mutation testing; prod backup before any migration).

## Providers and live reads
- Ethereum: public RPC (PublicNode) for ETH + USDC/USDT/DAI/WETH at pasted addresses;
  USD reference prices from on-chain Chainlink feeds (capped stablecoin feeds).
- Aave V3 (Ethereum): on-chain reads behind `PORTFOLIO_AAVE_V3=1`; supplied balances and
  variable debt, reserve index times; live and verified at `51dbc7f`.
- Solana: SOL balance only via public RPC; plan §1 correctly reports it unreliable
  (bounded retries/fallback needed). No SPL tokens, NFTs, or Solana DeFi.
- Markets: DexScreener-selected Solana DEX pools for a fixed instrument list; tokenized
  equities are on-chain tokens, not stocks.
- No provider API keys anywhere in the codebase; no server secrets beyond the D1 binding
  and Pages env flags (`PORTFOLIO_LIVE_DATA`, `PORTFOLIO_ACCOUNTS`, `MARKETS_OVERVIEW`,
  `PORTFOLIO_AAVE_V3`; exact string `1`, applied to new deployments only).

## Routes vs the plan's IA
- Live product routes: landing, Overview (sidebar), `/track` (single-address lookup +
  Aave section), `/markets`, `/start`, `/education`, `/settings`.
- `/portfolio` renders the **simulated demo dashboard** (`Dashboard view="overview"`,
  invented $12k/$1k/$11k figures) — plan §5.1 requires removing this from production
  portfolio routes; fixtures must live only in tests.
- `/welcome`, `/connect`, `/explore`, `/start`: orientation content pages.
- `/learn`: learning library; `/education` also exists — plan §8 wants ONE `/learn/*`
  shell; the duplicate route families must merge.
- No Overview/Assets/DeFi/Risk & Return pages, no Addresses & Wallets manager,
  no native welcome/door with intentional-click animation gate.

## Risks and notes for the architecture note
1. Pages Functions + D1 can carry native auth (WebAuthn + email code + SIWE/SIWS)
   without a keyed third-party provider; runtime library qualification is pending (Isa).
2. Access removal must be last: replacement entitlement enforcement server-side first,
   migration rehearsed, rollback documented (plan §10 Phase B.5).
3. `localStorage` is used only in `features/onboarding/progress-provider.tsx`
   (learning-progress persistence), NOT in the account/portfolio layer — the canonical
   address list is already D1-backed. When native auth lands, progress persistence moves
   server-side for signed-in users (plan §4: no localStorage for canonical account data).
4. Demo/live coexistence is a code change only (no data migration): the simulated
   dashboard is a component, not stored data.
