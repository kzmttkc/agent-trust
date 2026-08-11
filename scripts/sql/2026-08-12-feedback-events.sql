-- NewFeedback event index (2026-08-12).
--
-- Moves the ERC-8004 NewFeedback scan off the synchronous scoring path. The
-- live 7-day scan was ~151 eth_getLogs round-trips at the operator's
-- configured chunk width, which cannot complete inside any request budget on
-- the current RPC plan; it always degraded to `feedback_stats_unavailable`,
-- which assessSybilRisk maps to high risk → unconditional BLOCK. Every agent
-- scored BLOCK for that reason alone.
--
-- Rows are written ONLY by the trusted indexer (src/lib/indexer/feedback-indexer.ts),
-- never by API scoring. Safe to re-run:
--   psql "$DATABASE_URL" -f scripts/sql/2026-08-12-feedback-events.sql
CREATE TABLE IF NOT EXISTS feedback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id bigint NOT NULL DEFAULT 8453,
  agent_id bigint NOT NULL,
  client_address text NOT NULL,
  block_number bigint NOT NULL,
  log_index integer NOT NULL,
  tx_hash text NOT NULL,
  indexed_at timestamptz DEFAULT now()
);

-- Idempotent re-scan: a chunk replayed after a partial run must not double
-- count. (tx_hash, log_index) identifies a log uniquely within a chain.
CREATE UNIQUE INDEX IF NOT EXISTS feedback_events_log_unique
  ON feedback_events (chain_id, tx_hash, log_index);

-- The only read shape: "events for this agent at or after block N".
CREATE INDEX IF NOT EXISTS feedback_events_agent_block_idx
  ON feedback_events (chain_id, agent_id, block_number);

-- Retention pruning scans by block number across all agents.
CREATE INDEX IF NOT EXISTS feedback_events_block_idx
  ON feedback_events (chain_id, block_number);
