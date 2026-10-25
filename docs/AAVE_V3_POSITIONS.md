# Aave V3 positions - preparatory design (NOT active)

Status: **preparatory only**. No live calls, no provider wiring into the lookup path, no UI, no deployment.
Activation is held until the original owner-approval scope for live DeFi position reads is resolved
(see "Authority" below). This document is the reviewable milestone for that preparation.

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

Composition to resolve BEFORE activation: whether "the live app with accounts running" covers live
Aave position reads, given the earlier explicit gate on deploying live financial data. That call
belongs to the owner, presented with both texts; it is not assumed here.

## Remaining before activation could even be proposed

1. Owner scope resolution (above).
2. UI section + claims wiring behind the reviewed copy, with e2e coverage (mocked RPC only).
3. Aggregate-model slot for positions (debt direction, no double counting) with unit tests.
4. One bounded live verification read, only after approval, with observation-time capture.
5. Progress-File update only at a warranted milestone.
