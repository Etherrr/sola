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
3. Rollback: copy-not-move means tracked_addresses stays intact; reverting is removing
   the claim affordance. Data deletion of legacy rows is a separate, later,
   owner-approved operation.
4. Cutover: after QA (invited new user, returning user, wallet-verified, two-account
   isolation, expired session, provider timeout), remove the customer-facing Access
   policy on the app host; keep Access on preview/staging hosts and admin. Documented
   rollback = re-enable the Access policy (no data change).

## 5. Staging
- Pages preview deployments on `v0.2-preview` (already Access-protected) + a NEW
  isolated preview D1 database bound only for preview (separation verified before any
  mutation; synthetic fixtures only). Production D1 is never a test-write fallback.

## 6. Open items
- WebAuthn server library for Workers runtime — Isa researching; fallback hand-rolled.
- Email sending from Pages Functions (native OTP) needs a mail path: transactional
  email provider = keyed service = owner decision; interim: keep Access email-code as
  the email factor during dual-gate while native email challenge ships only on staging.
- Solana reliability work (bounded retries/fallback) is Phase C, independent of auth.
