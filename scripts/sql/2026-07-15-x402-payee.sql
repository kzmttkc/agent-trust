-- Feature A: Payee Trust API — add the receiving-wallet column to x402_payments
-- and backfill it for pre-existing rows (see scripts/backfill-payee.ts).
-- Safe to re-run. Apply with:
--   psql "$DATABASE_URL" -f scripts/sql/2026-07-15-x402-payee.sql

ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS payee text;

CREATE INDEX IF NOT EXISTS x402_payments_payee_created_idx ON x402_payments (payee, created_at);

-- Existing rows are left with payee = NULL by this migration on purpose.
-- Run `npm run backfill:payee -- --dry-run` first, review the output, then
-- `npm run backfill:payee -- --apply` to populate them from on-chain data.
