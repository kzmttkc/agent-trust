-- Verified payees (N-16, 2026-08-05). Safe to re-run:
--   psql "$DATABASE_URL" -f scripts/sql/2026-08-05-verified-payees.sql
CREATE TABLE IF NOT EXISTS verified_payees (
  wallet text PRIMARY KEY,
  name text NOT NULL,
  url text,
  signature text NOT NULL,
  verified_at timestamptz DEFAULT now()
);
