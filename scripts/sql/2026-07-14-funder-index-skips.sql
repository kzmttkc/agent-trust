-- Audit fix (round 3, #3): negative cache for funder indexing so wallets
-- whose first incoming transfer can't be resolved stop being re-scanned on
-- every indexer run. Safe to re-run. Apply with:
--   psql "$DATABASE_URL" -f scripts/sql/2026-07-14-funder-index-skips.sql

CREATE TABLE IF NOT EXISTS funder_index_skips (
  wallet text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  last_attempt_at timestamptz DEFAULT now(),
  next_retry_at timestamptz NOT NULL
);
