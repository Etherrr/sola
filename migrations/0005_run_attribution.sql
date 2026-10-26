-- 0005: per-run network attribution + observation-time label on sync_runs
-- (reviewer R2 fix, 2026-10-26).
--
-- A sync run covers exactly ONE network (handleSync records one run per
-- network), but the run row carried no network marker: a complete run that
-- recorded ZERO rows (e.g. an emptied wallet) was invisible to read
-- baselines, which then resurrected prior holdings from older runs.
--
-- ADDITIVE and NULLABLE, NO BACKFILL: pre-0005 runs keep NULL network -
-- attribution unknown, never invented. Read paths attribute legacy runs only
-- through their snapshot rows; legacy zero-row runs never advance baselines.
--
-- observed_at is the run's provider observation time: the LABEL time for
-- per-network views, present even when the run recorded zero rows. Ordering
-- is always wall-clock requested_at; observed_at is never an ordering key.
--
-- Apply-before-ship discipline: same as 0004 - nothing that depends on these
-- columns ships before 0005 is actually applied and verified on the target.
ALTER TABLE sync_runs ADD COLUMN network TEXT;
ALTER TABLE sync_runs ADD COLUMN observed_at TEXT;
