-- vet402 2026-08-15 — health_snapshots: the /status page's only data source.
--
-- No cron writes this table. Vercel Hobby silently breaks deploys once a cron
-- runs more often than once a day (measured 2026-07-29), so a "sample every 5
-- minutes" cron was never an option on this infra. Instead, a row is written
-- opportunistically from the same probe StatusBanner already runs on every
-- public-page view (recordHealthSnapshotIfDue), throttled to at most one row
-- per 5 minutes unless the status actually changed. Real traffic supplies the
-- sampling interval; a quiet site simply accumulates fewer rows, and /status
-- reads that honestly instead of assuming "ok" for unobserved time.
--
-- Safe to re-run. Apply with:
--   psql "$DATABASE_URL" -f scripts/sql/2026-08-15-health-snapshots.sql

CREATE TABLE IF NOT EXISTS health_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  -- ok | degraded | error — the same three values runScoringProbe() returns.
  status text NOT NULL
);

CREATE INDEX IF NOT EXISTS health_snapshots_checked_at_idx
  ON health_snapshots (checked_at);
