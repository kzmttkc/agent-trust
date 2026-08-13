-- vet402 scoring-heart fix (2026-08-13) — close two same-root defects in the
-- x402 settlement ledger that let self-attestation move a trust score.
--
-- Two new columns on x402_payments, both nullable, no default, no backfill —
-- same discipline as 2026-08-05-x402-amount-verification.sql: an old row's
-- value was never observed, so inventing one (TRUE/FALSE or a timestamp) would
-- be manufacturing evidence. NULL is the honest "this row predates the check",
-- and every reader treats a score-eligible row as one that has BOTH a proven
-- owner AND a confirmed USDC amount, so legacy NULL rows simply stop counting
-- toward any score (which is correct — that history was forgeable).
--
--   block_timestamp    — the on-chain block time of the settlement tx, read
--                        from the receipt's block. The time axis of uniqueDays
--                        moves here from created_at (DB insert time). WHY: the
--                        write-back is idempotent per tx, but a caller could
--                        send a handful of real txs on ONE day and drip the
--                        inserts across a fortnight, so created_at showed "14
--                        active days" for one day of real settlement. Block
--                        time is not something the caller picks.
--   ownership_verified — TRUE only when the write-back carried a valid EIP-191
--                        signature by `wallet` over the canonical attestation
--                        message (proof the poster controls the paying wallet,
--                        the same proof-of-control gate verified payees use).
--                        FALSE when no/invalid signature. NULL on legacy rows.
--                        A row is score-eligible only when this is TRUE — so
--                        posting a STRANGER's real on-chain transfer (which the
--                        old path accepted) records a row but cannot move that
--                        stranger's score.
--
-- Safe to re-run. Apply with:
--   psql "$DATABASE_URL" -f scripts/sql/2026-08-13-x402-block-time-and-ownership.sql

ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS block_timestamp timestamptz;
ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS ownership_verified boolean;

-- The score-eligibility read filters on (token, amount_verified,
-- ownership_verified); a partial index on the eligible rows keeps the payer-
-- and payee-side aggregates cheap as the ledger grows.
CREATE INDEX IF NOT EXISTS x402_payments_wallet_eligible_idx
  ON x402_payments (wallet, block_timestamp)
  WHERE ownership_verified = true AND amount_verified = true;

CREATE INDEX IF NOT EXISTS x402_payments_payee_eligible_idx
  ON x402_payments (payee, block_timestamp)
  WHERE ownership_verified = true AND amount_verified = true;

-- Deliberately no backfill: old rows keep NULL block_timestamp (readers fall
-- back to created_at for those) and NULL ownership_verified (never TRUE, so
-- never score-eligible). Nothing here rewrites the meaning of an existing row.
