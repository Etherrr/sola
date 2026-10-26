# Education rearchitecture - cold preparation (plan §8, Phase D)

Prepared 2026-10-25 on v0.2-preview. Inventory + migration map only: no route, content,
persistence or guest-access change is made here. Each phase is separately reviewable.

## Current inventory (verified against source)

**Lesson registry** (`content/lessons/index.ts`, 6 modules, each with sections + one
knowledge-check question):

| id | path | eyebrow |
| --- | --- | --- |
| basics | `/start` | 01 / BLOCKCHAIN BASICS |
| wallets | `/start/wallets` | 02 / WALLET GUIDE |
| security | `/start/security` | 03 / SECURITY FIRST |
| addresses | `/learn/addresses` | 04 / ADDRESSES & NETWORKS |
| defi | `/start/defi` | 05 / SOLANA & SWAP EDUCATION |
| risks | `/learn/risks` | 06 / LENDING, STAKING & LIQUIDITY |

**Other education routes:**
- `/learn` - the learning library landing (progress indicator + module cards + the two
  interactives below). This is the natural shell root.
- `/learn/network-journey`, `/learn/security-lab` - interactive simulations, already
  labeled `INTERACTIVE · SIMULATED`; simulated content never touches portfolio surfaces.
- `/start/networks` - "network field notes" page, NOT in the registry; linked from
  `/learn/addresses` (Back) and `/start/defi` (Skip). Orphan relative to the registry.
- `/education` - duplicate marketing landing (hero + journey cards to `/start`,
  `/connect`, `/demo`). Linked from the app shell nav (`/education` "Education" button)
  and the entrance card. Plan §8: ONE `/learn/*` shell; the duplicate families merge.

**Progress persistence** (`features/onboarding/progress-provider.tsx`): lesson completion
only; localStorage is opt-in ("Progress saved on this browser" / visit-only default). No
portfolio data. Plan §4: server-side persistence for signed-in users arrives with native
auth - a later phase, not this one.

**Regression pins that reference these routes:**
- `tests/e2e/journeys.spec.ts` - route list includes `/education`, `/start`,
  `/start/{wallets,security,networks,defi}`, `/learn`, `/learn/{addresses,risks,security-lab}`;
  navigation journey asserts landing -> `/education` -> `/start` -> `/start/wallets`.
- `tests/e2e/bfcache.spec.ts`, `tests/copy-claims.test.ts`, `tests/journey.test.ts`,
  `tests/security-lab.test.ts` - content/copy pins on the same routes.

## Target taxonomy (plan §8 sections) mapped onto existing modules

| Plan section | Existing content | Target route |
| --- | --- | --- |
| Start Here | basics (`/start`) | `/learn/start-here` |
| Fundamentals | addresses (`/learn/addresses`) + networks field notes (`/start/networks`) | `/learn/fundamentals` (+ networks folds in as a section) |
| Wallets & Networks | wallets (`/start/wallets`) | `/learn/wallets` |
| DeFi Strategies | defi (`/start/defi`) + risks (`/learn/risks`) | `/learn/defi-strategies`, `/learn/lending-and-risk` |
| Risk & Security | security (`/start/security`) | `/learn/security` |
| Practice exercises | network-journey, security-lab | stay at `/learn/network-journey`, `/learn/security-lab` |

## Phased migration (each phase its own review-routed head)

- **E1 - registry-driven paths, zero content change.** Give each lesson a canonical
  `/learn/*` path in the registry; render lesson pages from the registry at the new
  routes; 308-redirect the old `/start/*` paths. Move the `/start/networks` field notes
  into the Fundamentals module (registry member). Update journeys/bfcache/copy pins in
  the SAME commit (redirect + destination assertions).
- **E2 - shell navigation.** `/learn` landing grouped by the five plan sections with a
  return-to-portfolio action. The app-shell "Education" button stays on `/education`:
  `tests/copy-claims.test.ts` pins `/education` as the reviewed single education
  destination, so the repoint waits for the grouped entry to be reviewed.
- **E3 - retire `/education` + repoint.** Redirect `/education` -> `/learn`; entrance card
  and app-shell button repointed; remove the duplicate landing page; update the
  copy-claims shell pin and journeys nav assertions in the same commit.
- **E4 (later, with native auth)** - server-side progress persistence for signed-in
  users; guest behavior unchanged.

## Explicitly unchanged in every phase

- Guest access policy: education content stays public as today; no entitlement change.
- No portfolio metrics, balances or provider calls inside any lesson page.
- Simulations stay labeled `INTERACTIVE · SIMULATED` and out of portfolio totals.
- Lesson copy itself is not rewritten in E1-E3 (content quality is a separate pass).
