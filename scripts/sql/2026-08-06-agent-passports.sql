-- Agent passports (A-10, 2026-08-06). The symmetric twin of verified_payees:
-- an agent proves control of its ERC-8004 identity by signing a canonical
-- message with the wallet getAgentWallet(agentId) returns on-chain. Safe to
-- re-run:
--   psql "$DATABASE_URL" -f scripts/sql/2026-08-06-agent-passports.sql
CREATE TABLE IF NOT EXISTS agent_passports (
  agent_id bigint PRIMARY KEY,
  wallet text NOT NULL,
  name text NOT NULL,
  url text,
  signature text NOT NULL,
  verified_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_passports_wallet_idx ON agent_passports (wallet);
