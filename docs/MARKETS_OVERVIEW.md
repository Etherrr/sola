# Markets overview (M-MARKETS-1) — sources, mints and integration contract, 2026-10-25

Status: LOCAL BRANCH ONLY (feat/markets-overview), not deployed. The route stays behind the
`MARKETS_OVERVIEW=1` flag (default off) and the Cloudflare Access JWT gate; enabling it in
Production is a separate release decision after review.

## What it is

One "Market overview" section on `/markets`: on-chain USD prices for a fixed, named list of
five Solana instruments. It is deliberately NOT the whole financial market: coverage is the
listed Solana DEX pools only, and the UI says so. Funding, open interest and liquidations stay
unavailable (see MARKET_SOURCES_REVIEW.md). No wallet or account data is accepted, sent or
logged by this path; the upstream request URL contains only public token mints.

## Source and display rights

- **DexScreener** (`https://api.dexscreener.com/token-pairs/v1/solana/{mint}`): free, keyless,
  300 req/min on this endpoint family (https://docs.dexscreener.com/api/reference, read
  2026-10-25). API terms (https://docs.dexscreener.com/api/api-terms-and-conditions, last
  updated Aug 2023, read in full 2026-10-25) permit commercial and non-commercial use and
  contain NO attribution requirement; barred uses are competing products and reselling API
  access. This is why DexScreener is the milestone-1 display source.
- Jupiter (dev/test OK; production display unresolved under its SDK & API License), CoinGecko
  (free Demo needs account + "Powered by CoinGecko" attribution) and TradFi typed data (no
  verified free display license; TradingView widgets are display-only panels) are documented in
  the source-qualification handoff and remain UNCONFIGURED here.

## Canonical mint qualification (official issuer registries, verified 2026-10-25)

Symbol search is never accepted as identity. Each mint below was read from the named official
registry on 2026-10-25 and cross-checked live against DexScreener pool data:

- SOL: wrapped-SOL mint `So11111111111111111111111111111111111111112`, from the official
  SPL token interface source (`solana-program/token`, `interface/src/native_mint.rs`:
  `solana_pubkey::declare_id!("So11111111111111111111111111111111111111112")`).
  Displayed as SOL priced through wrapped SOL; the wrapper is named in the UI.
- TSLAx `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB`, NVDAx
  `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`, AAPLx
  `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`, SPYx
  `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W`: Solana deployments from Backed's official
  public registry `https://api.xstocks.fi/api/v2/public/assets/{symbol}` (no auth), which also
  records the issuer (Backed / xStocks) and the underlying ticker.
- Quote mints: USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (Circle official contract
  list, https://developers.circle.com/stablecoins/usdc-contract-addresses) and USDT
  `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` (Tether supported-protocols page,
  https://tether.to/en/supported-protocols/).

Adding or changing an instrument requires the same registry-grade proof and owner review.

## Data handling rules

- Pair qualification: chainId solana, allowlist mint as BASE only (prices are never inverted),
  quote mint in {USDC, USDT}, strict decimal-string price, pool liquidity >= $10,000.
- Displayed price = the qualified pool with the deepest liquidity; venue count and the
  max-to-min spread (BigInt math on decimal strings, no floats) are shown; warnings:
  `single-venue`, `few-pools`, `wide-dispersion` (> 1%).
- Pool liquidity is a JSON number used only for thresholding/ranking and displayed rounded
  with an "≈" marker; it is never a quote.
- DexScreener exposes no feed timestamp: the model carries `sourceUpdatedAt: null` and the UI
  says "Retrieved", never "Updated".
- Cache: per-isolate, 60 s TTL, single-flight, forced-refresh spacing 15 s, last-good served
  explicitly marked STALE for up to 10 minutes on source failure, then unavailable. No
  background polling anywhere; upstream calls happen only on a gated page view or explicit
  refresh. A missing price is never zero or reconstructed.
- Route: `GET /api/v1/markets/overview` (`?refresh=1` forces). Gates in order: kill switch
  `MARKETS_OVERVIEW=1`, Access JWT (`cf-access-jwt-assertion`, RS256 via team JWKS), same-origin
  Origin / `sec-fetch-site` checks. Fails closed. Deliberately NO D1 limiter layer: the cache
  bounds upstream traffic to one batch per TTL per isolate; reviewer may ask for the durable
  layer.

## Known limits (stated to the user in the UI)

Solana on-chain venues only. Tokenized equities are Backed xStocks tokens, not the underlying
stocks, and can trade above/below them; no underlying-market hours or reference prices yet.
Ondo tokenized assets are not in this milestone (Ondo's asset API requires a key).
