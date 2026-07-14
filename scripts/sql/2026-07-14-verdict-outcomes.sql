-- Phase 1 result-label collection: what actually happened to an agent/wallet
-- after a trust_events verdict. Populated by the outcome-detector indexer
-- (auto) and by partner reports (POST /v1/events/{trustEventId}/outcome).
-- Safe to re-run. Apply with:
--   psql "$DATABASE_URL" -f scripts/sql/2026-07-14-verdict-outcomes.sql
--
-- Note: all read/write paths in code (src/lib/db/outcome-writer.ts,
-- src/lib/indexer/outcome-detector.ts) degrade to a silent no-op if this
-- table hasn't been applied yet — DATABASE_URL is a Vercel "sensitive" env
-- var and cannot be read by CLI tooling for manual migration, so the code
-- must never hard-depend on this DDL being present.

CREATE TABLE IF NOT EXISTS verdict_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trust_event_id uuid NOT NULL,
  outcome_type text NOT NULL,
  related_wallet text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  window_minutes integer NOT NULL,
  source text NOT NULL DEFAULT 'auto',
  api_key_id uuid,
  evidence jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verdict_outcomes_trust_event_idx
  ON verdict_outcomes (trust_event_id);

CREATE INDEX IF NOT EXISTS verdict_outcomes_type_detected_idx
  ON verdict_outcomes (outcome_type, detected_at);

CREATE UNIQUE INDEX IF NOT EXISTS verdict_outcomes_unique
  ON verdict_outcomes (trust_event_id, outcome_type, source);
