-- Phase 1.5: harden x402_payments for payment attestation ingest
-- Safe to re-run. Apply with:
--   psql "$DATABASE_URL" -f scripts/sql/2026-07-14-x402-payments.sql

UPDATE x402_payments SET wallet = lower(wallet) WHERE wallet IS NOT NULL;
UPDATE x402_payments SET tx_hash = lower(tx_hash) WHERE tx_hash IS NOT NULL;

ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS api_key_id uuid;
ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS network text NOT NULL DEFAULT 'base';
ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS resource text;

DELETE FROM x402_payments WHERE wallet IS NULL OR tx_hash IS NULL OR tx_hash = '';

ALTER TABLE x402_payments ALTER COLUMN wallet SET NOT NULL;
ALTER TABLE x402_payments ALTER COLUMN tx_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS x402_payments_tx_hash_idx ON x402_payments (tx_hash);
CREATE INDEX IF NOT EXISTS x402_payments_wallet_created_idx ON x402_payments (wallet, created_at);
CREATE INDEX IF NOT EXISTS x402_payments_api_key_idx ON x402_payments (api_key_id);
