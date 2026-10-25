# Aave V3 positions - Track integration (local, pre-review)

Status: **integrated and tested locally; not deployed**. The owner approved integration and testing
on 25 Oct 2026 ("Let's add aave", iMessage phonemsg-01M5SHMNG00XY1MYTYHGPPC2T1 8:47 am, answering the
proposal to integrate and test read-only Aave V3 Ethereum supplied balances and variable debt on
Track). The section ships behind the default-off flag PORTFOLIO_AAVE_V3 ('1' only); production is
unchanged (b05ec66) and any release still requires the independent review + visual verification gate
and sets the flag only with the enabling deployment.

## Scope (what this would read, if ever activated)

Aave V3 on Ethereum mainnet only, for an address the user pastes or saves:
- supplied balances (aToken positions) per named asset;
- variable-debt balances per named asset.

Explicitly not included: stable-debt positions (the UiPoolDataProviderV3 interface exposes no
stable-debt read, so the result must never be described as all debt), health factor, APY, staking,
liquidity pools, or any other protocol. No account total, net-worth, or comprehensive-exposure
claim is made; values are incomplete by construction (option A: only assets covered by the app's
existing verified Chainlink feeds are priced; every other position is named with value Unknown).

## Mechanics (verified against sources, 25 Oct 2026)

- UiPoolDataProviderV3 `0x2dAd8162A989cd99D673dE4425Bb2298Db1E1aA2`,
  PoolAddressesProvider `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e`
  (bgd-labs/aave-address-book at HEAD; deployed source verified via Sourcify's address-scoped
  lookup - GET /server/v2/contract/1/0x2dAd8162A989cd99D673dE4425Bb2298Db1E1aA2 returns a verified
  match whose compilation is UiPoolDataProviderV3, and its interface source has the exact 40-word
  `AggregatedReserveData` layout the decoder implements; the reviewer confirmed the layout
  independently. Note: Sourcify match ids identify bytecode, not addresses - cite the
  address-scoped lookup, not the match id).
- Two read-only `eth_call`s through the existing PublicNode path (no new vendor, no key, free tier):
  `getReservesData(provider)` and `getUserReservesData(provider, user)`.
- Balances are `scaled x index` with Aave's own rayMul rounding, bigint only (no floats).
  The index is each reserve's **stored** index; a position's observation time is that reserve's
  `lastUpdateTimestamp`, rendered as the stored-index observation time, never as "current now".
- Decoding follows the repo's canonical-layout discipline: every offset and length is
  bounds-checked; non-canonical or overlapping layouts are rejected, not interpreted.
- Signed `int256` fields in `BaseCurrencyInfo` decode two's-complement and reject nonpositive or
  absurd values. Aave market-reference prices are decoded for validation only and dropped; no
  Aave price is ever consumed.
- Receipt (aToken) and variable-debt token addresses are excluded from any asset list
  (`positionTokenAddresses`): a receipt token is the position, not a second asset.
- Failure semantics: any RPC failure or malformed payload is an honest unavailable state with
  the reason; a missing position is not a zero; an empty result is a true empty.

## Draft user-facing copy (for review before any markup exists)

Section heading: "Aave V3 positions (Ethereum)"
Coverage line: "Supplied and variable-debt balances on Aave V3 (Ethereum) only. No stable debt,
health factor, APY, or other protocols. A missing position is not a zero."
Observation label per position: "Observed at the reserve's stored index time <ts>."
Unavailable state: "Aave positions could not be read. Nothing was substituted."
Value caveat: "Values cover only assets priced by this app's own verified feeds; anything else
is named with its value unknown. These positions are not your total account value."

## Authority (verbatim owner evidence)

- v0.2 brief (iMessage phonemsg-01M5MVMX4RFQ4FK6NY0KDQ6FM2, 23 Oct 2026 1:06:29 pm EDT):
  "Do not implement signing, transactions, approvals, custody, or wallet-secret handling. Do not
  deploy live financial data or request production credentials without approval." DeFi positions
  enter the roadmap only by reference ("Implement the Sola Lens v0.2 roadmap... Read AGENTS.md,
  SPEC.md, docs/APP_SCOPE.md, and docs/V0_2_BUILD_SCOPE.md"); SPEC.md's v0.2 row names "balances
  and selected DeFi positions".
- Live-app grant (iMessage phonemsg-01M5RHMR84NAJYM43JY7Q7QHRR, 24 Oct 2026 11:28:36 pm EDT):
  "you can do everything to get the live app with accounts running as long as the entry stays
  secure. no need for approvals. I trust your judgement".

Composition RESOLVED for integration and testing on 25 Oct 2026: the owner answered the explicit
proposal ("shall I proceed with integrating and testing read-only supplied balances and variable
debt?") with "Let's add aave" (iMessage phonemsg-01M5SHMNG00XY1MYTYHGPPC2T1, 8:47 am). The approval
covers integration and testing with the stated limits (no wallet connection, signing or fund
movement; current verified pricing only; honest incomplete semantics). Release timing and the
enabling deployment remain gated by independent review and the standing release discipline.

## Integration record (25 Oct 2026)

1. Owner scope resolution: approved for integration and testing (above).
2. UI section + claims wiring: `features/portfolio/aave-section.tsx` renders the three honest states
   (positions / true empty / unavailable-never-substituted) from the reviewed copy; e2e covers all
   three plus parser rejection and flag-off absence (mocked responses only).
3. Aggregate-model slot: `features/portfolio/aave-model.ts` maps positions to Supplied/Debt rows
   (debt direction in kind, receipt exclusion, no double counting) with unit tests; Overview wiring
   is a later milestone, not part of this approval.
4. Bounded live validation read (25 Oct 2026 ~9:07 am Toronto, one run: 1 multicall + 1 reserves +
   2 user eth_calls against PublicNode, read-only): the strict decoders accepted the real full
   mainnet reserves payload and real user payloads; 0x0000...dEaD returned 12 real positions -
   priced assets valued only by the app's Chainlink feeds, wstETH value Unknown (never zero), real
   stored-index observation times (e.g. 2026-10-25T13:05:11Z); a true-empty wallet returned an ok
   empty section. No deployment followed; the read was validation only.
5. Release: pending independent review of 68c2a0e + 49cf349 on top of the reviewed preparation
   (base b05ec66); the flag is set only with the enabling deployment (Pages env applies to new
   deployments only).
