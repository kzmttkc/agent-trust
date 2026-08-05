-- x402 amount verification — record what the CHAIN said, not only what the
-- caller claimed.
--
-- Why: POST /api/v1/payments/x402 verified the tx hash, the success status and
-- the payer wallet, but stored `amount` exactly as it arrived in the request
-- body. A product that sells verification was keeping an unverified number in
-- a row it calls verified. The wallet-match condition could also be satisfied
-- by a Transfer of ANY ERC20, so the settlement token was never pinned to USDC
-- either.
--
-- These three columns are read from the same settlement Transfer log the
-- `payee` column already comes from (no extra RPC call):
--   onchain_amount  — the transferred amount in the token's base units
--   token           — the ERC20 contract that actually moved
--   amount_verified — NULL: the caller declared no amount (always allowed)
--                     FALSE: declared, but not confirmed (wrong token, wrong
--                            figure, or unreadable log)
--                     TRUE: declared, settled in Base USDC, figures equal
--
-- All nullable on purpose: pre-existing rows keep NULL, which reads as
-- "unknown", never as "verified". Safe to re-run. Apply with:
--   psql "$DATABASE_URL" -f scripts/sql/2026-08-05-x402-amount-verification.sql

ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS onchain_amount text;
ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS token text;
ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS amount_verified boolean;

-- Deliberately no backfill and no default. An old row's amount was never
-- checked against anything, and writing TRUE or FALSE onto it would be
-- inventing a verification result that never happened. NULL is the honest
-- value: this row predates the check.
