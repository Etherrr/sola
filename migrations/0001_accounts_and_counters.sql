-- Applied once, only after the owner approves creating the D1 binding.
-- Mirrors server/accounts/d1.ts SCHEMA_SQL + COUNTERS_SQL; keep in sync.
CREATE TABLE IF NOT EXISTS tracked_addresses (
  owner_issuer_subject TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('ethereum', 'solana')),
  address TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_issuer_subject, network, address)
);
CREATE TABLE IF NOT EXISTS rate_counters (
  scope TEXT NOT NULL,
  owner TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  window_ms INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (scope, owner, window_start, window_ms)
);
