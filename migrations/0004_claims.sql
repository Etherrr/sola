-- Migration 0004 (DRAFT - review only; NOT APPLIED anywhere): account-data claiming (B.3 v4).
-- Spec: docs/ACCOUNT_CLAIM_DESIGN.md @ e297033 section 1 (reviewer-approved design, REHEARSAL-0-verified semantics).
--
-- claims_ledger: one row per claim attempt. The partial unique index is the
-- atomic arbiter for racing claims (D1/D3/D6 proven on actual D1 2026-10-26)
-- and permits a fresh attempt after a rollback (reviewer RULED reclaim allowed).
-- 'rolled_back' rows are retained until owner-approved purge (reviewer RULED).
CREATE TABLE IF NOT EXISTS claims_ledger (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  state TEXT NOT NULL CHECK (state IN ('claimed','rolled_back')),
  created_at TEXT NOT NULL,
  rolled_back_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS claims_one_active ON claims_ledger(owner_key) WHERE state='claimed';

-- claim_before_images: verbatim legacy copy INCLUDING updated_at (which the
-- native schema drops). Dispute/provenance evidence only - never a
-- normal-restore source (legacy rows are retained, never deleted).
CREATE TABLE IF NOT EXISTS claim_before_images (
  ledger_id TEXT NOT NULL REFERENCES claims_ledger(id),
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ledger_id, network, address)
);

-- claims_ledger_rows: exact per-row provenance, DISPOSITION ONLY.
-- v3's per-row state column and all residue_hold machinery are REMOVED
-- (reviewer 2026-10-26 02:10 headline ruling).
CREATE TABLE IF NOT EXISTS claims_ledger_rows (
  ledger_id TEXT NOT NULL REFERENCES claims_ledger(id),
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('copied','skipped_live_dup','skipped_tombstone_dup')),
  PRIMARY KEY (ledger_id, network, address)
);
