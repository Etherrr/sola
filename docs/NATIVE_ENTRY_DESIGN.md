# Sola-native entry and account onboarding — design preparation (2026-10-25)

Status: PREPARATION ONLY. This document authorizes nothing: no Access policy change, no
session issuance, no route-gating change, no wallet signing, no dashboard action, no
identity migration and no production storage change. No grant is assumed to switch
Access off, migrate identities, or perform wallet signatures; each of those is a
separate explicit owner decision. Baseline: production release branch head 660a81b.
Owner: web-app agent. Independent review is required before any implementation PR, and
each implementation step is its own reviewed PR.

## 0. Owner evidence (verbatim, recovered from the channel record)

- 2026-10-23 22:44:26 EDT, user (phonemsg-01M5NWQ7E0GB6SGT2FY4MX783X, iMessage,
  verified phone): asks "are we going to switch off the cloudflare auth and to a
  different account system or stick to this for now?"
- 2026-10-23 13:06:29 EDT, owner v0.2 brief (phonemsg-01M5MVMX4RFQ4FK6NY0KDQ6FM2,
  iMessage, verified phone; references AGENTS.md, SPEC.md, docs/APP_SCOPE.md,
  docs/V0_2_BUILD_SCOPE.md and an executive handoff PDF). Verbatim limits: "Do not
  implement signing, transactions, approvals, custody, or wallet-secret handling. Do
  not deploy live financial data or request production credentials without approval."
  Also: "Preserve Cloudflare Access protection and free-tier operation wherever
  practical." This brief is the owner-established source of the no-signing limit.
- 2026-10-23 22:44:38 EDT, agent reply (phonemsg-01M5NWQGNJW5W70H7MQKFJ39B7) restated
  that posture to the owner. Context only: an agent restatement plus owner
  non-objection does NOT establish or extend an owner limit; the 13:06 brief above is
  the actual authority.
- 2026-10-24 23:28:36 EDT, user grant (phonemsg-01M5RHMR84NAJYM43JY7Q7QHRR):
  "you can do everything to get the live app with accounts running as long as the
  entry stays secure. no need for approvals. I trust your judgement". Scope: free
  tier, secure entry, read-only.
- 2026-10-24 23:40:56 EDT, user sign-in notes (phonemsg-01M5RJBDARDQTN8Q7AJN820S0G),
  verbatim:
  - "even if using cloudflare sign in, should be hidden via the web app interface"
  - "ability to connect wallet would be good as a log in, even whatever just pops up
    (metamask,onekey)"
  - "to connect multiple wallets, need to create an account —> auto upgrade if
    connected wallet attaches another (onboard)"
  - "the animation should play everytime the app needs to load/intro"
- 2026-10-24 23:41:06 EDT, user (phonemsg-01M5RJBMDX6EDJANXXK6AY78BG): "sign out
  button as well" — SHIPPED (account menu sign-out with Access-scope disclosure; do
  not duplicate). The load/intro animation note is also already SHIPPED (entrance).

Note the tension: the owner's 13:06 v0.2 brief prohibits signing; the owner's
later 23:40 notes ask for wallet-connect-as-login, which needs signatures. The 23:28
grant already superseded another 13:06 limit ("Do not deploy live financial data ...
without approval"), so the owner does update these limits explicitly - but no explicit
revocation of the no-signing limit exists. This tension is decision gap G2 below;
this document does not resolve it.

## 1. Current entry architecture (verified from source @ 660a81b)

1. **Edge gate.** A Cloudflare Access (Zero Trust) policy fronts the entire Pages site:
   every route and asset (static pages, `/_next/*`, all `/api/v1/*` functions) redirects
   unauthenticated requests to the Cloudflare-hosted Access login (email one-time code).
   The policy and its allowed-identity list live in the Cloudflare account, not in this
   repo. Re-verified 2026-10-25 07:25 UTC: unauthenticated `/portfolio/`,
   `/api/v1/portfolio/resolve` and `/api/v1/portfolio/accounts` all return 302 to the
   Access login.
2. **API gate (defense in depth).** Pages Functions independently verify the
   `cf-access-jwt-assertion` JWT (`server/portfolio/access.ts`): RS256 via jose, pinned
   team domain + audience, JWKS fetch with one throttled refresh on key rotation, finite
   failure categories only (never token/claim values), fail-closed on any doubt.
3. **Identity derivation.** The verified `iss` + `sub` claims become the owner key
   (`iss#sub`, issuer regex-pinned to `*.cloudflareaccess.com`) used for D1 saved-address
   rows and for the per-identity lookup limiter. A client-supplied owner or email is never
   accepted. The email claim reaches the UI only through `/api/v1/session`.
4. **Session UX.** A latest-wins, abortable session check
   (`features/portfolio/session-check.ts`) drives the account menu (identity + Sign out
   with the honest Access-scope disclosure) and the once-per-session entrance greeting.
5. **Sign-in UX today** is Cloudflare's hosted page (OTP to an allowed email). Branding,
   copy and onboarding flow are not Sola-owned. Audiences today: EVERYTHING (including
   marketing/education pages) sits behind Access; the only audience is the allowed
   identity list.

## 2. Goal

A Sola-native entry surface: Sola-owned sign-in UX and account onboarding, preserving the
current security posture (every app route and API behind verified authentication,
fail-closed), per the 23:40 owner notes. Wallet-connection login is prototyped at most
display-only until signature-based proof is separately decided (G2).

## 3. Options

| Option | Entry UX | Security model change | Execution blocker |
| --- | --- | --- | --- |
| A. Branded Access hosted login | Sola-branded login page served by Cloudflare Access; OTP flow unchanged | None: edge gate and JWT layer untouched | Configuration is dashboard-only; dashboard access is currently blocked (Turnstile, terminal — no retry without a new signal) |
| B. Full Sola-native session | Fully Sola-owned sign-in (email code first; passkey candidate later) and onboarding; public marketing surface + gated app area | Access edge gate replaced by app-issued sessions; see section 5 | Multi-PR program; final Access switch-off needs dashboard access AND the explicit secure-entry decision (G1); email delivery path unresolved (G4) |
| C. Wallet sign-in (SIWE / Solana sign-in) | Sign a sign-in message with a wallet | New authentication factor | Blocked by the signature authority gap (G2); display-only connect proves nothing about ownership |
| D. Additive Sola-native onboarding behind retained Access (recommended near-term milestone) | Sola-owned onboarding/orientation surfaces inside the app; Access login itself remains Cloudflare's | None: edge gate, JWT layer and audiences untouched | None for a visual-only prototype; content changes are a reviewed delta |

### Option A — verified route

Cloudflare documents the path at
https://developers.cloudflare.com/cloudflare-one/reusable-components/custom-pages/access-login-page/
(read 2026-10-25): Zero Trust dashboard > Reusable components > Custom pages > Access
login page > Manage — organization name, logo, custom header/footer, background color,
applied to all Access applications. The doc page states no plan gate; actual plan
gating is NOT confirmed (account is on Zero Trust Free; dashboard is Turnstile-blocked,
so the setting itself cannot be inspected by us). This satisfies the owner's "hidden via
the web app interface" note only partially: Sola branding on the login page, but the URL
and flow remain Cloudflare-hosted. It requires the user's dashboard session (not a
fallback we can execute) or a new dashboard-access signal.

### Option D — what an additive milestone can and cannot deliver

CAN deliver without touching the gate, all reviewable repo deltas:
- A Sola-native onboarding/orientation surface inside the gated app (visual-only
  prototype first): what the app covers, how saved public addresses work, honest
  coverage limits, where sign-out lives. Complements — never duplicates — the shipped
  entrance animation and sign-out.
- The stale `/connect` copy correction (section 7).
- Public/private audience preservation: everything stays behind Access; no route
  becomes public. The single-identity private audience is unchanged.

CANNOT deliver:
- Hiding the Cloudflare login page itself (needs option A branding or option B
  replacement).
- Wallet-connect-as-login (G2) and native account creation with cross-wallet upgrade
  (option B territory; the current multi-address view already groups multiple saved
  public addresses per identity, without proving ownership).
- Any public marketing surface (that is a deliberate audience change under option B).

## 4. Threat model (baseline today, and option B delta)

Baseline (today, options A/D unchanged):
- Edge + API double gate, fail-closed; JWT RS256 verified with pinned team domain and
  audience; JWKS rotation throttled; failure categories finite, no token values logged.
- Threats already mitigated: forged/expired/missing JWT; client-supplied owner
  spoofing; cross-owner row access (owner predicate on every query); per-identity
  lookup limiting.
- Residual: Access session is shared across apps on the same Access account (sign-out
  disclosure covers this); account-specific Access logs and session policies are
  dashboard-side and uninspected.

Option B introduces and must answer:
- **Code brute force / guessing**: single-use, short-TTL, high-entropy codes hashed at
  rest; per-email and per-IP attempt limits (durable D1 counters + per-isolate layer,
  fail-closed on storage error); lockout with bounded retry delay.
- **Enumeration**: identical responses for allowed and disallowed emails.
- **Session fixation / theft**: rotate session id on sign-in and privilege change;
  `__Host-` HttpOnly Secure SameSite=Lax cookie; ids hashed at rest; never in URLs or
  logs; absolute + idle expiry; revocation on sign-out.
- **CSRF**: SameSite=Lax plus Origin/Sec-Fetch-Site checks on every mutation, matching
  the existing same-origin JSON validation pattern.
- **Public-surface expansion**: newly public routes must never serve account data;
  `_middleware` gate verified route-by-route in e2e; API authorization stays
  per-function, never middleware-only.
- **Identity spoofing at migration**: re-keying rows from Access `iss#sub` to a native
  subject on email match is a one-way step (G3); requires atomic transaction, audit
  row, and a second identity never being able to claim the rows.
- **Email delivery abuse**: provider-side send limits; code emails disclose nothing
  beyond the code.

## 5. Option B design sketch (for review, not implementation)

**Public vs gated surface.** Marketing/education pages (`/`, `/start/*`, `/learn/*`,
`/education/*`) become public; the app area (`/portfolio/*`, `/track`, `/markets`,
`/settings`, all `/api/v1/*` except health/networks/session) requires a valid Sola
session. This is a deliberate audience change and part of the G1 decision. Gating is
enforced twice, mirroring today: a Pages Functions `_middleware.ts` redirecting
unauthenticated page requests, AND per-function session verification on every API.

**Sign-in.** Email + one-time code per section 4 (8 digits, CSPRNG, single-use,
10-minute TTL, SHA-256 at rest, never logged). Allowed-identity list: initially the
same single identity as today, stored as config, never derived from client input. Code
delivery needs an email-sending path (G4).

**Session.** D1 record: random 128-bit id (hashed at rest), subject (normalized email),
created/expires/last-used; absolute expiry 30 days with 24h idle sliding renewal;
explicit revocation on sign-out. Cookie per section 4.

**Identity derivation.** `ownerKey` becomes `native#<subject>` behind the same
interface; API handlers take the subject from the verified session record, never from
the client.

**Identity migration (one-way, G3).** Existing D1 rows are keyed by Access `iss#sub`.
Choices: (a) link-on-first-native-login: when the native subject's email matches the
Access identity's email, re-key rows once, atomically, with an audit row; (b) leave
orphaned and start fresh (data loss for saved addresses); (c) dual-read during a
transition window. Preliminary pick: (a), with the email match treated as evidence only
because the native sign-in itself verifies control of that email inbox.

**Parallel run and rollback.** Access stays ON while the native system is built and
reviewed behind it. Cutover = switch the Access policy off (dashboard action + G1
decision) once the native gate passes its acceptance gates. Rollback = re-enable the
Access policy; the native system is additive until cutover, so rollback never strands
data. Migration re-keying is the one irreversible step and runs only after cutover is
accepted.

## 6. Decision gaps (genuine; not routine approval stops)

- **G1. Secure-entry condition.** The 23:28 grant is conditioned on the entry staying
  secure. Replacing the Access edge gate changes the security model. No grant to switch
  Access off is assumed: the equivalence argument (sections 4–5) must be reviewed, and
  the switch-off is an explicit owner decision, also blocked on dashboard access (G5).
- **G2. Signature authority.** Owner evidence cuts both ways: the 13:06 v0.2 brief
  (verbatim above) prohibits signing, and the later 23:40 notes (verbatim above) ask
  for wallet-connect-as-login. Neither message mentions the other; the no-signing
  limit has no explicit revocation. Until the owner resolves this, no signing is
  presumed anywhere in this design, no wallet-signature flow is built, and a
  display-only wallet connection is not proof of ownership and must never grant a
  session. Option C work starts only after the owner's explicit decision.
- **G3. Identity migration choice** (section 5) is a one-way data decision.
- **G4. Email delivery path.** Sign-in codes need transactional email (provider or
  Cloudflare Email Workers); provider choice has free-tier and domain-authentication
  (SPF/DKIM) implications not yet researched. No provider selected.
- **G5. Dashboard access** (Turnstile, terminal) blocks option A configuration and
  option B's final switch-off. No retry without a new signal.

## 7. Accompanying reviewed content delta: `/connect` stale copy

`app/connect/page.tsx` still described pre-live state ("does not accept addresses or
query a blockchain", "NOT AVAILABLE IN v0.1", blanket SIMULATED marker, "Open simulated
portfolio"). The delta in this branch rewrites it against shipped capabilities:
live read-only public-address lookup (ETH five-asset list; SOL balance only), saved
addresses per signed-in identity, the labeled demo fixture as a separate state, and the
unchanged no-wallet-connection/no-signature posture. Content-only; no behavior change.

## 8. Acceptance gates for any future implementation PR

- Unauthenticated: every app route and API 302/401s; no asset or API leaks without a
  session (mirror the current Access negative gates, plus `_next` assets).
- Codes: single-use under concurrency; TTL enforced; lockout works;
  enumeration-resistant responses; codes never in logs or responses.
- Sessions: fixation rotation; idle + absolute expiry; sign-out revokes; cookie flags
  asserted in e2e.
- CSRF: cross-origin mutations rejected.
- Migration: atomic re-key; second identity cannot claim rows; audit row;
  orphaned-owner behavior documented.
- No regression: existing unit/e2e suites stay green; new suites for all of the above.

## 9. Explicitly not in this preparation

No native auth scaffolding code (held until the architecture decision justifies it), no
schema changes, no provider selection, no signing flows, no dashboard actions, no
public-route changes. The only code delta in this branch is the `/connect` copy
correction (section 7) and this document.
