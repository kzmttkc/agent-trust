-- vet402 2026-08-14 — operator override transparency log (append-only, PUBLIC).
--
-- The EF/Vitalik blocker: an operator could add a GLOBAL blacklist entry
-- (operator_policy BLOCK) with no reason, no signal trail, invisible to the
-- scored party — a silent single censorship point that contradicts credible
-- neutrality. This table turns every GLOBAL operator act into an auditable
-- public record (target address, action, reason, timestamp), served openly by
-- GET /api/transparency/operator-overrides and /operator-log and covered by the
-- same keyless dispute routes as any score (ToS §8).
--
-- CUSTOMER-scoped lists are NOT recorded here: a customer's own whitelist/
-- blacklist is their private management right over their own traffic, not an
-- operator act of network-wide censorship. Only apiKeyId=NULL (global) writes
-- land here (see addCustomerListEntry in src/lib/db/customer-lists.ts).
--
-- Readers (listOperatorOverrides) tolerate this table being absent
-- (isMissingSchemaError → empty log), and the writer degrades loudly rather than
-- failing the list write, so deploy-ordering is safe.
--
-- Safe to re-run. Apply with:
--   psql "$DATABASE_URL" -f scripts/sql/2026-08-14-operator-overrides.sql

CREATE TABLE IF NOT EXISTS operator_overrides (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet text NOT NULL,
  -- 'blacklist_added' | 'blacklist_removed'
  action text NOT NULL,
  -- Why the operator applied it — required, never blank (enforced at the API).
  reason text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_overrides_created_idx
  ON operator_overrides (created_at);
