-- Webhook endpoints (2026-08-05 R&D, C-9).
--
-- Why: Vouch was pull-only. A customer gating x402 settlement on a score had
-- no way to learn that the world changed between lookups (an agent they
-- scored got blacklisted; an outcome landed on a verdict they were issued)
-- short of polling every wallet they ever scored. This table backs
-- src/lib/webhooks.ts: registration via /api/v1/webhooks, Stripe-style
-- signed delivery, auto-disable after consecutive failures.
--
-- `secret` is stored as written because it signs OUTBOUND payloads — it is a
-- per-endpoint signing key we generated (whsec_...), not a customer
-- credential, and it is shown to the customer exactly once.
--
-- Safe to re-run. Apply with:
--   psql "$DATABASE_URL" -f scripts/sql/2026-08-05-webhooks.sql

CREATE TABLE IF NOT EXISTS webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid NOT NULL,
  url text NOT NULL,
  secret text NOT NULL,
  events jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  failure_count integer NOT NULL DEFAULT 0,
  last_delivered_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhooks_api_key_idx ON webhooks (api_key_id);
