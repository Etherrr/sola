-- DRAFT for staging only (v0.2-preview). Never applied to production without the
-- review-gated migration rehearsal + production backup in docs/V0_2_ARCHITECTURE.md §4.
-- Native Sola identity: users, identities, sessions, single-use challenges, wallet links,
-- entitlements, portfolios and observation snapshots. Existing 0001 tables untouched.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('email','passkey','wallet_evm','wallet_solana')),
  identifier TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  metadata TEXT,
  UNIQUE (kind, identifier)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  rotated_from TEXT,
  revoked_at TEXT,
  ip_hash TEXT,
  ua_hash TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Single-use challenges. claim_attempt_id is written by the ONE conditional UPDATE that
-- wins the claim; a session may be created only when this request's claim affected
-- exactly one row bound to ITS attempt id. A crash after a successful claim burns the
-- challenge: there is no automatic un-consume.
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email_code','webauthn_register','webauthn_login','wallet_evm','wallet_solana')),
  subject TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  claim_attempt_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
CREATE INDEX IF NOT EXISTS challenges_subject ON challenges(kind, subject);

CREATE TABLE IF NOT EXISTS wallet_links (
  chain TEXT NOT NULL CHECK (chain IN ('ethereum','solana')),
  address TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  verified_at TEXT NOT NULL,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  PRIMARY KEY (chain, address)
);

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  email TEXT,
  wallet_chain TEXT,
  wallet_address TEXT,
  invite_code TEXT,
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  display_prefs TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_addresses (
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  network TEXT NOT NULL CHECK (network IN ('ethereum','solana')),
  address TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  verification TEXT NOT NULL CHECK (verification IN ('watched','verified')),
  created_at TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY (portfolio_id, network, address)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  provider TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle','loading','live','partial','stale','error','unsupported')),
  error TEXT,
  completeness TEXT
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id TEXT PRIMARY KEY,
  sync_run_id TEXT NOT NULL REFERENCES sync_runs(id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS position_snapshots (
  id TEXT PRIMARY KEY,
  sync_run_id TEXT NOT NULL REFERENCES sync_runs(id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  protocol TEXT NOT NULL,
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  position TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_observations (
  id TEXT PRIMARY KEY,
  sync_run_id TEXT NOT NULL REFERENCES sync_runs(id),
  asset_id TEXT NOT NULL,
  usd TEXT NOT NULL,
  source TEXT NOT NULL,
  price_observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS privacy_consents (
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  version TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (user_id, kind, version)
);
