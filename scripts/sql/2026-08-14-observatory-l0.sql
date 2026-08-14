-- vet402 2026-08-14 — Observatory L0: the no-purchase, $0 observation layer
-- (WORK_ORDERS top item; design: output/0813/vet402_observatory_L0_design.md).
--
-- Four NEW tables; nothing existing is touched. The observatory ingests the
-- CDP Bazaar discovery catalog daily (~15k endpoints, public API), probes
-- each endpoint WITHOUT paying (the 402 challenge itself is the observable),
-- and records catalog disappearance as a delisting EVENT carrying its own
-- before/after evidence.
--
-- Facts only. The public pages over these tables publish pass/fail/unverified
-- — never a composite score, never an evaluative word (legal gate). Probe
-- methods come from the catalog's declared input.method, never guessed: a GET
-- probe against a POST endpoint reports a false death (x402 #3113 class).
-- Undeclared method → `unverified`, not `fail`.
--
-- Every reader tolerates these tables being absent (isMissingSchemaError →
-- cold start), so deploying code before this migration is safe.
--
-- Safe to re-run. Apply with:
--   psql "$DATABASE_URL" -f scripts/sql/2026-08-14-observatory-l0.sql

-- Catalog current-state: one row per discovered x402 endpoint.
CREATE TABLE IF NOT EXISTS x402_endpoints (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Normalized identity (host+path, routeTemplate preferred) so query-string
  -- noise cannot double-register an endpoint and poison the daily diff.
  resource_key text NOT NULL,
  resource_url text NOT NULL,
  source text NOT NULL DEFAULT 'cdp_bazaar',
  -- Declared HTTP method. NULL = undeclared → probes stay `unverified`.
  method text,
  network text,
  -- Representative receiver (accepts[0].payTo) — claim-join key against verified_payees.wallet.
  pay_to text,
  price_amount text,
  price_asset text,
  description text,
  declared_schema jsonb,
  quality_calls_30d bigint,
  quality_payers_30d bigint,
  quality_last_called_at timestamptz,
  -- Full accepts[] as received (multi-payTo/multi-chain evidence, auditability).
  raw_accepts jsonb,
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),
  -- active | delisted (history lives in x402_delisting_events).
  status text NOT NULL DEFAULT 'active',
  delisted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS x402_endpoints_key_source_unique
  ON x402_endpoints (resource_key, source);
CREATE INDEX IF NOT EXISTS x402_endpoints_payto_idx ON x402_endpoints (pay_to);
CREATE INDEX IF NOT EXISTS x402_endpoints_status_idx ON x402_endpoints (status);

-- Daily snapshot — raw material the diff is computed FROM. fetched_count <
-- total_count marks an incomplete fetch: delisting judgement is WITHHELD that
-- day (a fetch gap must never read as "the endpoint vanished").
CREATE TABLE IF NOT EXISTS x402_catalog_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 'YYYY-MM-DD' — one snapshot per source per day.
  snapshot_date text NOT NULL,
  source text NOT NULL DEFAULT 'cdp_bazaar',
  total_count integer NOT NULL,
  fetched_count integer NOT NULL,
  -- All resource_keys seen that day (set for diffing; full item JSON is NOT kept).
  resource_keys jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS x402_catalog_snapshots_date_source_unique
  ON x402_catalog_snapshots (snapshot_date, source);

-- L0 probe results — the fact timeline. Verdict vocabulary is closed:
-- pass | fail | unverified. Fail-closed points TOWARD unverified.
CREATE TABLE IF NOT EXISTS x402_l0_probes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id uuid NOT NULL,
  probed_at timestamptz DEFAULT now(),
  -- The method actually sent — always the catalog-declared one (#3113 guard).
  method text NOT NULL,
  verdict text NOT NULL,
  http_status integer,
  has_402_challenge boolean,
  accepts_valid boolean,
  price_consistent boolean,
  metadata_consistent boolean,
  latency_ms integer,
  -- Factual reason code: timeout | dns | tls | no_402 | price_mismatch | ...
  fail_reason text,
  -- Status/headers digest — evidence half of the legal 4-piece set for a published fail.
  raw_response_meta jsonb
);

CREATE INDEX IF NOT EXISTS x402_l0_probes_endpoint_probed_idx
  ON x402_l0_probes (endpoint_id, probed_at);
CREATE INDEX IF NOT EXISTS x402_l0_probes_verdict_idx ON x402_l0_probes (verdict);

-- Delisting/relisting/settle-drop events — alert feed + State of x402 material.
CREATE TABLE IF NOT EXISTS x402_delisting_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id uuid NOT NULL,
  -- delisted | relisted | probe_pass_to_fail | settle_drop
  event_type text NOT NULL,
  -- 'YYYY-MM-DD'
  detected_on text NOT NULL,
  prev_value jsonb,
  new_value jsonb,
  -- TRUE after webhook delivery to the claiming payee — the double-send guard.
  notified boolean NOT NULL DEFAULT false,
  notified_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS x402_delisting_events_endpoint_idx
  ON x402_delisting_events (endpoint_id);
CREATE INDEX IF NOT EXISTS x402_delisting_events_detected_idx
  ON x402_delisting_events (detected_on);
