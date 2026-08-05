-- Watchlist (N-15, 2026-08-05). Backs /api/v1/watchlist + the
-- watchlist-scan cron. Safe to re-run:
--   psql "$DATABASE_URL" -f scripts/sql/2026-08-05-watchlist.sql

CREATE TABLE IF NOT EXISTS watchlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid NOT NULL,
  target_type text NOT NULL,
  target text NOT NULL,
  chain_id integer NOT NULL DEFAULT 8453,
  last_score integer,
  last_recommendation text,
  last_checked_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS watchlist_api_key_idx ON watchlist_entries (api_key_id);
CREATE UNIQUE INDEX IF NOT EXISTS watchlist_unique
  ON watchlist_entries (api_key_id, target_type, target, chain_id);
