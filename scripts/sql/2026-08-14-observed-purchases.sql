-- vet402 2026-08-14 — L1 observed purchases: the PREMIUM economic-activity
-- signal that broadens the highest-weighted axis from "x402 facilitator
-- settlements only" to "verifiable real economic activity".
--
-- A row is vet402's own observatory recording that a wallet made a real purchase
-- from an independent seller AND that the good/service was delivered. That is a
-- strictly stronger fact than an x402 settlement row (which proves the money
-- moved, not that anything was delivered), so scoreEconomicActivity /
-- scoreL1Purchases score it ABOVE the x402 curve.
--
-- Written ONLY by the trusted observatory (recordObservedPurchase), never by API
-- scoring — the same trust boundary as funder_wallets and feedback_events. The
-- table is empty today (0 rows); the intake exists so the first real observation
-- becomes an ALLOW basis without a schema scramble later.
--
-- Every reader (getObservedPurchaseStats / getObservedDeliveryStats) tolerates
-- this table being absent (isMissingSchemaError → "no L1 history"), so deploying
-- the code before this migration is safe and simply reads as cold-start.
--
-- Safe to re-run. Apply with:
--   psql "$DATABASE_URL" -f scripts/sql/2026-08-14-observed-purchases.sql

CREATE TABLE IF NOT EXISTS observed_purchases (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- The BUYER whose economic activity this evidences (the payer).
  wallet text NOT NULL,
  -- The independent SELLER/counterparty. NULL = unresolved → never counts.
  counterparty text,
  -- USDC base units (6 decimals) the buyer actually paid, on-chain.
  amount text,
  -- The settlement tx; unique so a purchase is observed at most once.
  tx_hash text NOT NULL,
  -- What was purchased, when the observatory can name it.
  resource text,
  -- On-chain block time — the authoritative day axis, like x402_payments.
  block_timestamp timestamptz,
  -- TRUE only when the observatory confirmed delivery of the good/service. A row
  -- counts toward economic-activity scoring ONLY when this is TRUE.
  delivery_verified boolean NOT NULL DEFAULT false,
  -- Which observatory/probe recorded it (provenance, ops visibility).
  observed_by text,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS observed_purchases_tx_hash_idx
  ON observed_purchases (tx_hash);

-- Buyer-side aggregate: delivery-verified purchases per wallet, by block time.
CREATE INDEX IF NOT EXISTS observed_purchases_wallet_idx
  ON observed_purchases (wallet, block_timestamp)
  WHERE delivery_verified = true;

-- Seller-side aggregate: delivery-verified receipts per counterparty.
CREATE INDEX IF NOT EXISTS observed_purchases_counterparty_idx
  ON observed_purchases (counterparty, block_timestamp)
  WHERE delivery_verified = true;
