# DATA-01: Ethereum portfolio data provider evaluation

**Status: evaluation for owner review. No provider is selected and none is integrated.** Checked 2026-10-23. Method: public documentation, pricing pages and terms only; no accounts were created, no keys were used or requested, and no wallet data of any real user was queried. The only live calls were keyless public ones (listed under "What was tested"). Where a source disagreed with itself or could not be read, that is stated, not resolved by guess.

Scope is v0.2.0 from `docs/V0_2_BUILD_SCOPE.md`: Ethereum mainnet, manual public address, native ETH plus selected ERC-20 balances, prices where available, up to 5 addresses per request, wallet balances only.

## Candidates

|                                    | A. Alchemy (Portfolio/Data API)                                                                                                                                                                         | B. Zerion API                                                                                                                                                                                                                     | C. Direct RPC (PublicNode) + CoinGecko Demo prices                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Needs a key / account              | Yes (free tier signup)                                                                                                                                                                                  | Yes (free Developer key)                                                                                                                                                                                                          | RPC: no. CoinGecko Demo: keyless call worked; documented Demo plan needs an account for a key                                     |
| Ethereum balance method            | `POST /data/v1/{key}/assets/tokens/by-address` returns native and ERC-20 tokens with balances, prices and metadata                                                                                      | `GET` wallet fungible positions, priced, across chains                                                                                                                                                                            | `eth_getBalance` for ETH, `eth_call balanceOf` for each token                                                                     |
| ERC-20 discovery                   | Yes, the endpoint lists tokens held                                                                                                                                                                     | Yes, lists positions held                                                                                                                                                                                                         | **No.** Can only check a fixed allowlist of contracts. Full-history log scans are refused on the public endpoint (tested)         |
| Spam / scam handling               | Not confirmed in the pages I read                                                                                                                                                                       | Built in: `is_trash` flag and `filter[trash]`                                                                                                                                                                                     | None. Allowlist is the only protection                                                                                            |
| DeFi positions (Aave, LP, staking) | No DeFi position endpoint found in the Portfolio API pages I read (tokens, NFTs, transfers). Treat as not covered                                                                                       | Yes, separate positions with `filter[positions]` (`only_simple` default, `only_complex`, `no_filter`) incl. lending, staking, liquidity                                                                                           | None                                                                                                                              |
| Price source and time              | Included in the response (`withPrices`); Prices API is separate. Timestamp field not verified                                                                                                           | Price per position with `updated_at` shown in the reference                                                                                                                                                                       | CoinGecko `simple/token_price` by contract; `include_last_updated_at` returns a timestamp (tested)                                |
| Free limits                        | 30M compute units per month. Pricing-plans doc says 300 compute units per second; the marketing pricing page says 15 requests per second. **Sources disagree.** The by-address call is listed at 360 CU | Developer: 2,000 requests per day. 3 RPS on the pricing page; 10 RPS on a Feb 2026 Zerion blog post and an agents post. **Sources disagree.** DeFi Positions limited to 25% of the quota (about 500/day), not covered by overages | RPC: no stated quota found; public and best effort. CoinGecko Demo: 10,000 calls per month, 100 calls per minute per the API page |
| Request shape fit                  | Max 2 addresses and 5 networks per call, so 5 addresses need 3 calls                                                                                                                                    | Per-address call, so 5 addresses need 5 calls                                                                                                                                                                                     | 1 + N calls per address (N tokens)                                                                                                |
| Commercial terms                   | Not reviewed in full                                                                                                                                                                                    | API licence says Zerion may deny or revoke access for any reason and restricts use; needs owner/legal read before use                                                                                                             | CoinGecko Demo requires attribution; commercial-use terms not verified                                                            |
| Privacy / retention of addresses   | **Not verified.** Privacy policy and sub-processor list exist; address retention not found                                                                                                              | **Not verified**                                                                                                                                                                                                                  | PublicNode markets itself as privacy first; retention not verified. CoinGecko receives only contract addresses, not the wallet    |
| Cost if limits are exceeded        | Pay as you go, $0.525 per million CU (published)                                                                                                                                                        | Paid tiers exist; prices not confirmed here                                                                                                                                                                                       | None for RPC; CoinGecko paid plans start around $29 to $35 per month (pages differ)                                               |
| Single point of failure            | One vendor for balances and prices                                                                                                                                                                      | One vendor                                                                                                                                                                                                                        | Two public services, neither with an SLA                                                                                          |

## Rejected or parked

- **Moralis:** its docs state there is no self-serve free plan; a free trial is by request. Fails the near-$0 requirement without a sales step.
- **Blockscout PRO:** free plan lists 100,000 credits per day at 5 requests per second and has a token-balances endpoint, but it needs a key and I did not evaluate it further. Candidate for a second look.
- **Ankr Advanced API:** key-based freemium with `ankr_getAccountBalance`; limits and terms not evaluated.

## What was tested (2026-10-23, keyless, public data only)

- PublicNode `eth_getBalance` on a freshly generated random address: `0x0`, 200 in about 0.16 s. An empty wallet returns a valid zero.
- PublicNode `eth_getBalance` and an ERC-20 `balanceOf` `eth_call` on the public Ethereum Foundation address: both succeeded in about 0.15 to 0.22 s.
- PublicNode `eth_getLogs` over the full block range for token transfers: **refused with 403** ("Archive requests require a personal token"). Token discovery by scanning logs is not possible on the free public endpoint.
- CoinGecko keyless `simple/token_price` for USDC by contract address: 200 with a price and `last_updated_at`.

## Not tested, and why

- Alchemy and Zerion responses: no keys exist and none were requested. Their behaviour above is from documentation only.
- Sample wallets for an Aave supply/borrow, an LP receipt, a spam token, a wallet with many token contracts and an unknown-price token: these need either a keyed provider or specific public addresses the owner approves. **The reconciliation table the scope asks for is therefore not complete.**
- Outage behaviour, error shapes under 429, response latency under load: not measured.

## Known omissions in any wallet-balance-only release

DeFi deposits, staking, debts and LP claims will be missing. The UI must say so ("not total net worth") and treat a missing price as Unknown.

## Options for the owner

1. **Alchemy Token API** for v0.2.0: one call returns tokens and prices, fits the free quota with room (3 calls for 5 addresses at about 360 CU each), but covers wallet balances only and needs a key stored as a Cloudflare secret.
2. **Direct RPC allowlist + CoinGecko Demo**: no keys for balances, but only a fixed token list, no spam detection beyond that list, and two best-effort public services. Lowest cost and lowest data risk, weakest coverage. Suitable as a fallback or for a very small first release.
3. **Zerion** when DeFi positions are needed (v0.2.2 scope): the only candidate here with documented position coverage, at the cost of a small free quota and licence terms that need review.

**No recommendation is binding.** Selecting a provider, creating an account, or storing a key requires owner approval per the scope document.

## Cost fallback

All options can run at $0 within their published free limits, but those limits are small and two sources disagree on them. If a limit is hit, the live feature must show an explicit "unavailable" state, never simulated or cached-as-fresh data, and the kill switch in the scope document applies. Moving to a paid plan needs owner approval and a stated monthly cap before activation.

## Sources (read 2026-10-23)

- Alchemy plans: https://www.alchemy.com/docs/reference/pricing-plans , https://www.alchemy.com/pricing , compute costs: https://www.alchemy.com/docs/reference/compute-unit-costs , tokens by wallet: https://www.alchemy.com/docs/data/portfolio-apis/portfolio-api-endpoints/portfolio-api-endpoints/get-tokens-by-address
- Zerion: https://zerion.io/api , https://developers.zerion.io/rate-limits , https://developers.zerion.io/api-reference/wallets/get-wallet-fungible-positions , https://developers.zerion.io/spam-filtering , https://zerion.io/blog/top-questions-about-zerion-api/ , https://www.zerion.io/api-license-agreement
- PublicNode: https://publicnode.com/ , https://publicnode.com/terms
- CoinGecko: https://www.coingecko.com/en/api/pricing , https://docs.coingecko.com/reference/simple-token-price
- Moralis: https://docs.moralis.com/get-started/pricing
- Blockscout: https://docs.blockscout.com/devs/pro-api-routes
- Ankr: https://www.ankr.com/docs/advanced-api/pricing/
