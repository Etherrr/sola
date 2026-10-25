# Sola Lens — v0.2 architecture, auth flows and migration plan (plan §12.2)

Status: DRAFT for independent review. No material changes before this package clears review.
Runtime constraint: everything runs on Cloudflare Pages Functions + D1 (free tier);
no keyed third-party auth provider (owner decision required for any keyed service).

## 1. Entity model (new D1 tables; existing tables untouched until migration)

- `users(id TEXT PK opaque, status TEXT, created_at, updated_at)`
- `auth_identities(id PK, user_id FK, kind TEXT CHECK(kind IN
  ('email','passkey','wallet_evm','wallet_solana')), identifier TEXT normalized
  (email / credential id / chain:address), verified_at, metadata JSON, UNIQUE(kind, identifier))`
- `sessions(id PK opaque, user_id FK, created_at, expires_at, rotated_from NULL,
  revoked_at NULL, ip_hash NULL, ua_hash NULL)` — cookie carries only the opaque id;
  HttpOnly, Secure, `__Host-` prefix, SameSite=Lax; rotation on privilege change;
  reauthentication required for account-sensitive mutations.
- `email_challenges(id PK, email, code_hash, expires_at, consumed_at, attempts INT)` —
  single-use, 10-min expiry, hashed at rest, rate-limited per email and per IP.
- `webauthn_challenges(id PK, user_id NULL, challenge, kind CHECK('register'|'login'),
  expires_at, consumed_at)` — single-use, origin/RpID bound.
- `wallet_challenges(id PK, chain, address, nonce, message_hash, expires_at,
  consumed_at)` — SIWE (ERC-4361) / SIWS messages with domain, origin, nonce, expiry;
  server-issued single-use nonce; sign-in only, never transaction/approval signing.
- `wallet_links(user_id FK, chain, address, verified_at, challenge_id FK,
  PRIMARY KEY(chain, address))`
- `entitlements(email NULL, wallet NULL, invite_code NULL, granted_by, created_at,
  revoked_at)` — preview allowlist enforced server-side on every API route; a connected
  wallet without entitlement gets guest/nothing, never protected data.
- `portfolios(id PK, user_id FK, display_prefs JSON, created_at)` — one per user initially.
- `portfolio_addresses(portfolio_id FK, network, address_canonical, label,
  verification CHECK('watched'|'verified'), created_at, removed_at NULL,
  PRIMARY KEY(portfolio_id, network, address_canonical))`
- `sync_runs(id PK, user_id, requested/started/completed_at, provider, status, error,
  completeness)`
- `balance_snapshots / position_snapshots / price_observations` — immutable, tied to a
  sync_run, each with observed_at and (for prices) price_observed_at; never backfilled
  with fabricated history; periodic snapshots only after explicit consent.
- `privacy_consents(user_id FK, kind, version, consented_at, revoked_at NULL)`

Existing `tracked_addresses` and `rate_counters` stay as-is until the migration in §4.

## 2. Auth flows

A. Email-first: create account / sign in → email challenge (single-use code, hashed,
rate-limited, no enumeration: identical response for unknown email) → verify → user +
auth_identities(kind=email) → offer passkey registration (WebAuthn; library choice
pending Isa's Workers-compatibility findings, else minimal hand-rolled verification per
OWASP passkey cheat sheet) → session cookie. Passkey is the preferred repeat factor;
verified email challenge is the approved fallback. No account PIN.

B. Wallet-first: Connect wallet reveals the public address only (no authz). "Sign in
with wallet" → server nonce → SIWE/SIWS message (domain + origin + nonce + expiry) →
server verification (EOA ecrecover; ERC-1271 for contract accounts where relevant;
ed25519 verify for Solana) → user + auth_identities(kind=wallet_*) + wallet_links row
(verification='verified') → session. Wallet-only accounts carry a recovery-limitations
notice and an offer to add email/passkey. Message-signature gate only — never a
transaction or approval signature.

C. Returning: server-side session check on every API route; valid → data; expired/
revoked → 401, client shows native sign-in and resumes the original destination.
Sign-out-all = revoke all sessions for user. Deny-by-default per-record authorization:
every query carries user_id/owner predicates (existing D1 store pattern extends).

## 3. Security controls
- Rate limits on email sends, code verification, wallet challenges, login attempts
  (extend existing rate_counters pattern; durable global limiter).
- Atomic challenge consumption (advisory, Isa 2026-10-25): every single-use challenge
  (email code, WebAuthn challenge, SIWE/SIWS nonce) is consumed by ONE conditional
  UPDATE ... WHERE consumed_at IS NULL AND id = <current attempt>; a session is created
  ONLY when exactly one row was claimed by the current attempt. D1 batch atomicity is
  insufficient and zero-affected-rows is not a SQL error, so row-count claims are the
  gate; check-then-mark permits prior-consumer replay. The claim is bound to a fresh
  server-generated attempt ID; a session is created only when THIS request affected
  exactly one row carrying that attempt ID (consumed=true alone is insufficient). A
  crash after a successful claim burns the challenge — there is no automatic un-consume.
  Mandatory tests: concurrent claims produce exactly one session; sequential replay adds
  zero; expiry; crash-after-claim; attempt-ID collision.
- Auth != entitlement: before cutover, run host/direct-origin/preview bypass tests —
  a request that skips the app shell must still fail entitlement server-side.
- Negative-path test matrix (all mandatory before cutover): recovery at least as strong
  as primary sign-in with recent reauthentication for sensitive changes; OTP replay and
  rate limits; passkey RP-ID/origin/credential-ID checks; session fixation, revocation
  and CSRF; wallet-link non-transfer (a verified wallet cannot be re-linked to another
  account without a fresh challenge from that wallet).
- SIWS format binding: Solana sign-in supports exactly one expected message format per
  challenge (plain Wallet Standard SIWS vs offchain envelope); the server binds the
  expected format to the issued challenge and rejects any mismatch.
- CSRF: SameSite=Lax + strict Origin checks on mutations + unguessable session ids.
- Logging redaction: no codes, challenges, session ids, address/email linkage in logs.
- Input validation: EIP-55 checksum for EVM, base58 format for Solana, length limits;
  reject unsupported chain ids.
- Guest access: explicit product flag only; protected content entitlement-checked
  server-side regardless.

## 4. Migration (Access identity → native users), reversible

0. Precondition: production D1 backup via dashboard export (owner-visible step);
   staging rehearsal on the isolated preview D1 with synthetic fixtures only.
1. Ship native auth + entitlement enforcement alongside Access (Access still gates the
   host; app ALSO requires native session for account data). Dual-gate phase.
2. Claim flow: existing Access user signs in natively with the SAME email (verified by
   native email challenge). The app then shows their Access-linked saved addresses
   (read via the still-valid Access JWT in the same browser session) and offers
   "bring these into my Sola account". On confirm, server copies rows from
   tracked_addresses(owner=access-key) to portfolio_addresses(user) — never keyed on
   email text alone: the binding evidence is the live Access JWT + verified native
   email in one session.
3. Reconciliation: after claims, row counts and labels are reconciled between
   tracked_addresses and portfolio_addresses per owner; unmatched legacy rows stay
   claimable. Matching email/mailbox text alone is NEVER continuity proof — the binding
   evidence is the live Access JWT plus the freshly verified native email challenge in
   the same session.
4. Rollback: copy-not-move means tracked_addresses stays intact; reverting is removing
   the claim affordance. Data deletion of legacy rows is a separate, later,
   owner-approved operation.
5. Claim window (PROPOSED operational design — a design default, not a timed
   commitment; the exact window is confirmed only when retention and support
   feasibility are known): after the customer-facing Access
   policy is removed from the app host, the Access application RETAINS a narrow policy
   protecting only the claim route family (/claim/* and its API) for a defined window
   of 90 days post-cutover. Claims inside the window follow step 2. After the window,
   the Access policy is removed and remaining unclaimed legacy rows require an
   owner-assisted claim: the owner verifies the requester controls the legacy Access
   identity out-of-band (reply from the verified mailbox on file) and approves each
   assisted claim individually.
4. Cutover: after QA (invited new user, returning user, wallet-verified, two-account
   isolation, expired session, provider timeout), remove the customer-facing Access
   policy on the app host; keep Access on preview/staging hosts and admin. Documented
   rollback = re-enable the Access policy (no data change).

## 5. Staging
- Pages preview deployments on `v0.2-preview` (already Access-protected) + a NEW
  isolated preview D1 database bound only for preview (separation verified before any
  mutation; synthetic fixtures only). Production D1 is never a test-write fallback.

## 7. Native email verification dependency (blocking for the email path)

The claim flow and the plan's email-first path both require NATIVELY verified email,
and the retained Access email-code factor is a staging bridge only — it does not
satisfy the native design. Delivery-provider research (2026-10-25):
- Cloudflare Email Sending (Beta): arbitrary-recipient sending requires the Workers
  PAID plan; on Workers Free only pre-verified destination addresses in the account
  can receive mail. Native customer OTP to arbitrary users is therefore NOT available
  free-tier via Cloudflare. (developers.cloudflare.com/email-service/)
- Third-party transactional free tiers (e.g. Resend ~3k/mo) work from Pages Functions
  via plain HTTPS, but mean an external keyed provider, an API secret in Pages vars,
  and DNS (SPF/DKIM) changes on the sending domain — an owner decision.
- No-Agent-Mail rule honored: Instinct's own mail sender is not a substitute.
Consequence: the email-first path and email-verified claim stay DESIGN-BLOCKED until
the owner picks (a) Workers Paid for native Email Sending, (b) an external free-tier
sender with DNS changes, or (c) wallet/passkey-first account creation with email
deferred. Wallet sign-in (SIWE/SIWS) and passkey creation need no email and are NOT
blocked; the migration's claim flow can run its matching-email default using the
Access mailbox as the continuity anchor only where the native account is wallet-based
and explicitly claims the Access email as a watched contact — otherwise it waits for
the email decision.

## 8. Open items
- WebAuthn server library for Workers runtime: @simplewebauthn/server is the candidate
  (claims Workers support) pending an exact Pages packaging/runtime spike on staging;
  WebCrypto Ed25519 exists in the Workers runtime but is not package-compatibility
  proof; fallback is minimal hand-rolled verification per the OWASP passkey sheet.
- EVM SIWE verification (advisory, Isa 2026-10-25): candidate is viem's
  publicClient.verifySiweMessage (ERC-4361 + contract-account verification with block
  context) with explicit expected domain, stored nonce, time window, chain/account/URI
  policy and bounded fail-closed RPC. ERC-6492 undeployed-account support is NOT
  confirmed — qualify it or mark it honestly unsupported at release. Pin the exact viem
  version and spike it on staging; the jsr Workers listing is a different version and is
  not build proof. Do not choose the standalone `siwe` package on its official name:
  the provenance succession between signinwithethereum/siwe and spruceid/siwe is not
  established. Final library/version choices remain ours after runtime spikes.
- Email sending from Pages Functions (native OTP) needs a mail path: transactional
  email provider = keyed service = owner decision; interim: keep Access email-code as
  the email factor during dual-gate while native email challenge ships only on staging.
- Solana reliability work (bounded retries/fallback) is Phase C, independent of auth.
- Portfolio valuation invariants (advisory, Isa): Aave positions must model receipt
  vs underlying vs debt explicitly with netting rules that allow a negative net;
  a deterministic stale-price policy (never silently treat stale as fresh, never zero);
  "priced subtotal" is a subtotal, not a lower-bound claim. Tests: partial provider
  failures, duplicate deliveries, immutable idempotent snapshots, cross-user cache
  isolation, consent-withdrawal deletion vs in-flight jobs, watched-vs-verified
  separation. Snapshots are value-only; never P&L.
