import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const agents = pgTable(
  "agents",
  {
    agentId: bigint("agent_id", { mode: "bigint" }).primaryKey(),
    wallet: text("wallet"),
    chainId: bigint("chain_id", { mode: "number" }).notNull().default(8453),
    metadataUri: text("metadata_uri"),
    lastIndexed: timestamp("last_indexed", { withTimezone: true }),
  },
  (t) => [index("agents_wallet_idx").on(t.wallet)],
);

export const scoreSnapshots = pgTable("score_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: bigint("agent_id", { mode: "bigint" }),
  trustScore: bigint("trust_score", { mode: "number" }),
  recommendation: text("recommendation"),
  signals: jsonb("signals"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const trustEvents = pgTable(
  "trust_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    apiKeyId: uuid("api_key_id"),
    agentId: bigint("agent_id", { mode: "bigint" }),
    wallet: text("wallet"),
    trustScore: bigint("trust_score", { mode: "number" }),
    recommendation: text("recommendation"),
    signals: jsonb("signals"),
    manualOverride: text("manual_override"),
    blockReason: text("block_reason"),
    disclaimer: text("disclaimer"),
    cacheExpiresAt: timestamp("cache_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("trust_events_api_key_created_idx").on(t.apiKeyId, t.createdAt),
    index("trust_events_agent_id_idx").on(t.agentId),
  ],
);

export const ownerUsage = pgTable(
  "owner_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    period: text("period").notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
  },
  (t) => [uniqueIndex("owner_usage_user_period_unique").on(t.userId, t.period)],
);

export const ipRateLimits = pgTable("ip_rate_limits", {
  bucketKey: text("bucket_key").primaryKey(),
  count: bigint("count", { mode: "number" }).notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

export const cacheEpochs = pgTable("cache_epochs", {
  scope: text("scope").primaryKey(),
  epoch: bigint("epoch", { mode: "number" }).notNull().default(0),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    plan: text("plan").notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex("accounts_email_unique").on(t.email)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id"),
    name: text("name"),
    keyHash: text("key_hash").notNull(),
    plan: text("plan").notNull().default("free"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("api_keys_key_hash_idx").on(t.keyHash)],
);

export const apiUsage = pgTable(
  "api_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    apiKeyId: uuid("api_key_id").notNull(),
    period: text("period").notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    uniqueIndex("api_usage_key_period_unique").on(t.apiKeyId, t.period),
    index("api_usage_period_idx").on(t.period),
  ],
);

export const customerLists = pgTable(
  "customer_lists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    apiKeyId: uuid("api_key_id"),
    wallet: text("wallet").notNull(),
    listType: text("list_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("customer_lists_wallet_idx").on(t.wallet),
    index("customer_lists_api_key_idx").on(t.apiKeyId),
    uniqueIndex("customer_lists_scope_unique").on(t.apiKeyId, t.wallet),
  ],
);

/**
 * vet402 2026-08-14 — L1 observed purchases: the PREMIUM economic-activity
 * signal. A row is vet402's own observatory recording that a wallet made a real
 * purchase from an independent seller AND that the good/service was delivered.
 * This is a strictly stronger fact than an x402 settlement row (which proves the
 * money moved, not that anything was delivered), so it feeds the highest-weighted
 * axis above the x402 curve (scoreEconomicActivity / scoreL1Purchases).
 *
 * WRITTEN ONLY BY THE TRUSTED OBSERVATORY (recordObservedPurchase), never by API
 * scoring — the same trust boundary as funder_wallets and feedback_events. The
 * table is empty today (0 rows); the intake exists so the first real observation
 * becomes an ALLOW basis without a schema scramble later.
 *
 * SQL: scripts/sql/2026-08-14-observed-purchases.sql (readers tolerate a missing
 * table via isMissingSchemaError, degrading to "no L1 history" — never a throw).
 */
export const observedPurchases = pgTable(
  "observed_purchases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The BUYER whose economic activity this evidences (the payer). */
    wallet: text("wallet").notNull(),
    /** The independent SELLER/counterparty. NULL = unresolved → never counts. */
    counterparty: text("counterparty"),
    /** USDC base units (6 decimals) the buyer actually paid, on-chain. */
    amount: text("amount"),
    /** The settlement tx; unique so a purchase is observed at most once. */
    txHash: text("tx_hash").notNull(),
    /** What was purchased, when the observatory can name it. */
    resource: text("resource"),
    /** On-chain block time — the authoritative day axis, like x402_payments. */
    blockTimestamp: timestamp("block_timestamp", { withTimezone: true }),
    /**
     * TRUE only when the observatory confirmed the purchased good/service was
     * actually delivered. A row counts toward economic-activity scoring ONLY
     * when this is TRUE — an observed settlement with no delivery confirmation
     * is exactly an x402-strength fact, not an L1 one, and must not be scored
     * as the premium signal.
     */
    deliveryVerified: boolean("delivery_verified").notNull().default(false),
    /** Which observatory/probe recorded it (provenance, ops visibility). */
    observedBy: text("observed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("observed_purchases_tx_hash_idx").on(t.txHash),
    index("observed_purchases_wallet_idx").on(t.wallet, t.blockTimestamp),
    index("observed_purchases_counterparty_idx").on(t.counterparty, t.blockTimestamp),
  ],
);

/**
 * vet402 2026-08-14 — operator override transparency log (append-only, PUBLIC).
 *
 * The EF/Vitalik blocker: an operator could add a GLOBAL blacklist entry
 * (operator_policy BLOCK) with no reason, no signal trail, invisible to the
 * scored party — a silent single censorship point that contradicts credible
 * neutrality. This table turns every such GLOBAL operator act into an auditable
 * public record: target address, action, reason, timestamp. Served openly by
 * GET /api/transparency/operator-overrides and /operator-log, and covered by the
 * same keyless dispute routes as any score (ToS §8).
 *
 * CUSTOMER-scoped lists are NOT recorded here: a customer whitelisting/blacklisting
 * for their OWN integration is their private management right, not an operator
 * act of global censorship. Only apiKeyId=NULL (global) writes land here.
 *
 * SQL: scripts/sql/2026-08-14-operator-overrides.sql (readers tolerate a missing
 * table, degrading to an empty log rather than throwing).
 */
export const operatorOverrides = pgTable(
  "operator_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    wallet: text("wallet").notNull(),
    /** 'blacklist_added' | 'blacklist_removed'. */
    action: text("action").notNull(),
    /** Why the operator applied it — required, never blank. */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("operator_overrides_created_idx").on(t.createdAt)],
);

export const funderWallets = pgTable(
  "funder_wallets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    funder: text("funder").notNull(),
    wallet: text("wallet").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex("funder_wallets_unique").on(t.funder, t.wallet)],
);

/**
 * Negative cache for funder indexing: wallets whose first incoming transfer
 * could not be resolved (fetchFirstIncomingTransfer returned null). Without
 * this, unresolvable wallets stay in collectWalletsToIndex's candidate set
 * forever and get re-scanned (and re-billed against the RPC budget) on every
 * run. Entries are retried with growing backoff rather than excluded
 * permanently, since resolvability can change once a wallet finally receives
 * a transfer.
 */
export const funderIndexSkips = pgTable("funder_index_skips", {
  wallet: text("wallet").primaryKey(),
  attempts: integer("attempts").notNull().default(1),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).defaultNow(),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }).notNull(),
});

export const ownerAgents = pgTable(
  "owner_agents",
  {
    owner: text("owner").notNull(),
    agentId: bigint("agent_id", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("owner_agents_unique").on(t.owner, t.agentId),
    index("owner_agents_owner_idx").on(t.owner),
    index("owner_agents_agent_idx").on(t.agentId),
  ],
);

/**
 * ERC-8004 NewFeedback events (2026-08-12). Written only by the trusted
 * indexer (src/lib/indexer/feedback-indexer.ts); read by
 * fetchRecentFeedbackStats to answer "how much feedback, from how many
 * distinct clients, in the last N days" without an eth_getLogs scan on the
 * request path.
 *
 * The window is expressed in BLOCK NUMBERS, not timestamps, because that is
 * exactly how the chain scan it replaces defined "recent"
 * (`latestBlock - blocksPerDay * windowDays`). Storing a timestamp and
 * filtering on it would be a quieter definition change to a sybil signal, and
 * the whole point of this table is that the signal's meaning does not move.
 *
 * SQL: scripts/sql/2026-08-12-feedback-events.sql (fallback-tolerant readers —
 * every consumer tolerates a missing table).
 */
export const feedbackEvents = pgTable(
  "feedback_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chainId: bigint("chain_id", { mode: "number" }).notNull().default(8453),
    agentId: bigint("agent_id", { mode: "bigint" }).notNull(),
    clientAddress: text("client_address").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    logIndex: integer("log_index").notNull(),
    txHash: text("tx_hash").notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("feedback_events_log_unique").on(t.chainId, t.txHash, t.logIndex),
    index("feedback_events_agent_block_idx").on(t.chainId, t.agentId, t.blockNumber),
    index("feedback_events_block_idx").on(t.chainId, t.blockNumber),
  ],
);

export const indexerCheckpoints = pgTable("indexer_checkpoints", {
  scope: text("scope").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  chainTipAtRun: bigint("chain_tip_at_run", { mode: "bigint" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const dashboardSessions = pgTable(
  "dashboard_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    apiKeyId: uuid("api_key_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("dashboard_sessions_token_hash_idx").on(t.tokenHash),
    index("dashboard_sessions_api_key_idx").on(t.apiKeyId),
  ],
);

/**
 * Result-label collection (phase 1): what actually happened to an agent/wallet
 * after a trust_events verdict was issued. Populated two ways — auto-detected
 * by the outcome-detector indexer (src/lib/indexer/outcome-detector.ts) and
 * partner-reported via POST /v1/events/{trustEventId}/outcome. This is the
 * foundation for measuring score accuracy later; nothing reads from it yet.
 */
export const verdictOutcomes = pgTable(
  "verdict_outcomes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trustEventId: uuid("trust_event_id").notNull(),
    outcomeType: text("outcome_type").notNull(),
    relatedWallet: text("related_wallet"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    windowMinutes: integer("window_minutes").notNull(),
    /** 'auto' | 'partner:{apiKeyId}' */
    source: text("source").notNull().default("auto"),
    /** Set only when source is a partner report. */
    apiKeyId: uuid("api_key_id"),
    /** tx hash / feedback log / notes+evidenceUrl, depending on outcomeType. */
    evidence: jsonb("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("verdict_outcomes_trust_event_idx").on(t.trustEventId),
    index("verdict_outcomes_type_detected_idx").on(t.outcomeType, t.detectedAt),
    uniqueIndex("verdict_outcomes_unique").on(t.trustEventId, t.outcomeType, t.source),
  ],
);

/**
 * Webhook endpoints (2026-08-05 R&D, C-9). One row per registered endpoint;
 * at most MAX_WEBHOOKS_PER_KEY per api key (enforced in lib/webhooks.ts).
 * `secret` is stored as written because it SIGNS outbound payloads — it is a
 * per-endpoint signing key we generated, not a customer credential, and it
 * is shown to the customer exactly once at registration.
 * SQL: scripts/sql/2026-08-05-webhooks.sql (fallback-tolerant readers).
 */
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    apiKeyId: uuid("api_key_id").notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    /** subset of WEBHOOK_EVENTS the endpoint subscribed to */
    events: jsonb("events").notNull(),
    active: boolean("active").notNull().default(true),
    failureCount: integer("failure_count").notNull().default(0),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("webhooks_api_key_idx").on(t.apiKeyId)],
);

/**
 * Watchlist (N-15, 2026-08-05). A customer registers targets to monitor; the
 * watchlist-scan cron re-scores them and fires a `watch.verdict_changed`
 * webhook when the recommendation moves. This is what turns the score API
 * into a monitoring service — and what the Scale plan actually sells.
 * SQL: scripts/sql/2026-08-05-watchlist.sql.
 */
export const watchlistEntries = pgTable(
  "watchlist_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    apiKeyId: uuid("api_key_id").notNull(),
    /** 'agent' | 'wallet' */
    targetType: text("target_type").notNull(),
    target: text("target").notNull(),
    chainId: integer("chain_id").notNull().default(8453),
    lastScore: integer("last_score"),
    lastRecommendation: text("last_recommendation"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("watchlist_api_key_idx").on(t.apiKeyId),
    uniqueIndex("watchlist_unique").on(t.apiKeyId, t.targetType, t.target, t.chainId),
  ],
);

/**
 * Verified payees (N-16, 2026-08-05). A payee proves control of their wallet
 * by signing a canonical message; verified entries get a public profile and
 * an embeddable badge. The two-sided registry: spending agents check payees
 * here, payees display the badge — the moat is the network, not the row.
 * SQL: scripts/sql/2026-08-05-verified-payees.sql.
 */
export const verifiedPayees = pgTable(
  "verified_payees",
  {
    wallet: text("wallet").primaryKey(),
    name: text("name").notNull(),
    url: text("url"),
    signature: text("signature").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow(),
  },
);

/**
 * Agent passports (A-10, 2026-08-06). The symmetric twin of verifiedPayees:
 * where a payee proves control of a RECEIVING wallet, an agent proves control
 * of its ERC-8004 identity by signing a canonical message with the wallet that
 * `getAgentWallet(agentId)` returns on-chain. The signature binds (agentId,
 * wallet, name); the on-chain wallet lookup binds agentId→wallet. Together
 * they let an agent proactively present a verifiable "trust passport" —
 * identity + live score + x402 history — to win better terms, the mirror of
 * the buyer-side Verified Payee check.
 *
 * Keyed on agentId (an agent has one identity); `wallet` is the resolved
 * canonical wallet at verification time, stored so a reader can re-verify the
 * signature without a chain round-trip. SQL: scripts/sql/2026-08-06-agent-passports.sql
 * (fallback-tolerant readers — every consumer tolerates a missing table).
 */
export const agentPassports = pgTable(
  "agent_passports",
  {
    agentId: bigint("agent_id", { mode: "bigint" }).primaryKey(),
    wallet: text("wallet").notNull(),
    name: text("name").notNull(),
    url: text("url"),
    signature: text("signature").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("agent_passports_wallet_idx").on(t.wallet)],
);

export const x402Payments = pgTable(
  "x402_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    wallet: text("wallet").notNull(),
    amount: text("amount"),
    txHash: text("tx_hash").notNull(),
    apiKeyId: uuid("api_key_id"),
    network: text("network").notNull().default("base"),
    resource: text("resource"),
    /**
     * Receiving wallet — the `to` side of the verified ERC20 Transfer log
     * (see extractPayeeFromReceipt in src/lib/chain/x402-verify.ts). `wallet`
     * above stays the payer for backward compatibility with existing
     * payer-side scoring (scoreX402Payments). Nullable: pre-existing rows
     * predate this column (see scripts/backfill-payee.ts) and a small number
     * of settlements cannot be resolved to a Transfer log at all (native
     * transfer edge case — see that function's fallback comment).
     */
    payee: text("payee"),
    /**
     * 2026-08-05. `amount` above is whatever the caller POSTed and was never
     * checked against anything: the route accepted a free-form string and
     * stored it next to an on-chain-verified tx hash, so a "verified" payment
     * row could carry a made-up figure. These three columns are what the CHAIN
     * says, read from the same settlement Transfer log the payee comes from.
     *
     *  - onchainAmount: the transferred amount in the token's base units.
     *  - token: the ERC20 contract that actually moved. Only BASE_USDC counts
     *    as an x402 settlement; any other token means the wallet-match
     *    condition was satisfied by an unrelated transfer.
     *  - amountVerified: true only when the caller declared an amount AND the
     *    settlement leg is USDC AND the two agree exactly. null on rows that
     *    predate this column, false when we could not confirm — never
     *    conflated with "no amount was sent".
     */
    onchainAmount: text("onchain_amount"),
    token: text("token"),
    amountVerified: boolean("amount_verified"),
    /**
     * vet402 2026-08-13. The on-chain block time of the settlement tx (read
     * from the receipt's block), NOT the DB insert time. uniqueDays and
     * lastPaymentAt are computed from this so a caller cannot manufacture a
     * multi-day settlement streak by dripping inserts of one day's txs across
     * a fortnight — block time is not something the caller picks. NULL on rows
     * that predate this column; readers coalesce to created_at for those.
     */
    blockTimestamp: timestamp("block_timestamp", { withTimezone: true }),
    /**
     * vet402 2026-08-13. TRUE only when the write-back carried a valid EIP-191
     * signature by `wallet` (proof the poster controls the paying wallet — the
     * same proof-of-control gate verified payees use). A row counts toward any
     * score only when this is TRUE, so posting a stranger's real on-chain
     * transfer records a row but cannot move that stranger's score. NULL on
     * legacy rows (never TRUE → never score-eligible).
     */
    ownershipVerified: boolean("ownership_verified"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("x402_payments_tx_hash_idx").on(t.txHash),
    index("x402_payments_wallet_created_idx").on(t.wallet, t.createdAt),
    index("x402_payments_api_key_idx").on(t.apiKeyId),
    index("x402_payments_payee_created_idx").on(t.payee, t.createdAt),
  ],
);

// ============================================================
// vet402 Observatory L0 (2026-08-14) — the no-purchase, $0 observation layer.
//
// Four tables, all NEW — nothing above this line changed. The observatory
// ingests the CDP Bazaar discovery catalog daily, probes every endpoint
// without paying (the 402 challenge itself is the observable), and records
// delisting as an EVENT with before/after evidence. Facts only: the public
// pages built on these tables publish pass/fail/unverified — never a
// composite score, never an evaluative word (legal gate, mvt design §11).
//
// Probe methods come from the catalog's declared `input.method` — never
// guessed. A GET probe against a POST-declared endpoint reports a false
// death (x402 issue #3113 class); undeclared methods are recorded as
// `unverified`, not `fail`.
// ============================================================

/** Catalog current-state: one row per discovered x402 endpoint. */
export const x402Endpoints = pgTable(
  "x402_endpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /**
     * Normalized identity (host+path, routeTemplate preferred over raw
     * resource) so query-string noise cannot double-register an endpoint —
     * a duplicate key would poison the daily diff into phantom delistings.
     */
    resourceKey: text("resource_key").notNull(),
    resourceUrl: text("resource_url").notNull(),
    /** Discovery source; future-proofs multi-source ingestion (x402scan etc). */
    source: text("source").notNull().default("cdp_bazaar"),
    /** Declared HTTP method from extensions.bazaar.info.input.method. NULL = undeclared → probe stays `unverified`. */
    method: text("method"),
    network: text("network"),
    /** Representative receiver (accepts[0].payTo) — the claim-join key against verifiedPayees.wallet. */
    payTo: text("pay_to"),
    priceAmount: text("price_amount"),
    priceAsset: text("price_asset"),
    description: text("description"),
    declaredSchema: jsonb("declared_schema"),
    qualityCalls30d: bigint("quality_calls_30d", { mode: "number" }),
    qualityPayers30d: bigint("quality_payers_30d", { mode: "number" }),
    qualityLastCalledAt: timestamp("quality_last_called_at", { withTimezone: true }),
    /** Full accepts[] as received — multi-payTo/multi-chain evidence, auditability. */
    rawAccepts: jsonb("raw_accepts"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
    /** active | delisted — current catalog presence (history lives in x402_delisting_events). */
    status: text("status").notNull().default("active"),
    delistedAt: timestamp("delisted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("x402_endpoints_key_source_unique").on(t.resourceKey, t.source),
    index("x402_endpoints_payto_idx").on(t.payTo),
    index("x402_endpoints_status_idx").on(t.status),
  ],
);

/**
 * Daily catalog snapshot — the raw material the diff is computed FROM, kept
 * so a disputed delisting can be re-derived. fetchedCount < totalCount marks
 * an incomplete fetch: delisting judgement is WITHHELD that day (a fetch gap
 * must never read as "the endpoint vanished" — verify-the-instrument).
 */
export const x402CatalogSnapshots = pgTable(
  "x402_catalog_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** 'YYYY-MM-DD' — one snapshot per source per day. */
    snapshotDate: text("snapshot_date").notNull(),
    source: text("source").notNull().default("cdp_bazaar"),
    totalCount: integer("total_count").notNull(),
    fetchedCount: integer("fetched_count").notNull(),
    /** All resourceKeys seen that day (set for diffing; full item JSON is NOT kept — it would bloat). */
    resourceKeys: jsonb("resource_keys").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex("x402_catalog_snapshots_date_source_unique").on(t.snapshotDate, t.source)],
);

/** L0 probe results — the fact timeline. Facts only; the verdict vocabulary is closed: pass | fail | unverified. */
export const x402L0Probes = pgTable(
  "x402_l0_probes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    endpointId: uuid("endpoint_id").notNull(),
    probedAt: timestamp("probed_at", { withTimezone: true }).defaultNow(),
    /** The method actually sent — always the catalog-declared one (see header note on #3113). */
    method: text("method").notNull(),
    /** pass | fail | unverified. Fail-closed points TOWARD unverified: no proof ≠ dead. */
    verdict: text("verdict").notNull(),
    httpStatus: integer("http_status"),
    has402Challenge: boolean("has_402_challenge"),
    acceptsValid: boolean("accepts_valid"),
    priceConsistent: boolean("price_consistent"),
    metadataConsistent: boolean("metadata_consistent"),
    latencyMs: integer("latency_ms"),
    /** Factual reason code: timeout | dns | tls | no_402 | price_mismatch | ... — never an evaluative word. */
    failReason: text("fail_reason"),
    /** Status/headers digest — the evidence half of the legal 4-piece set for any published fail. */
    rawResponseMeta: jsonb("raw_response_meta"),
  },
  (t) => [
    index("x402_l0_probes_endpoint_probed_idx").on(t.endpointId, t.probedAt),
    index("x402_l0_probes_verdict_idx").on(t.verdict),
  ],
);

/** Delisting/relisting/settle-drop events — alert feed + State of x402 material. Evidence (prev/new) travels with the event. */
export const x402DelistingEvents = pgTable(
  "x402_delisting_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    endpointId: uuid("endpoint_id").notNull(),
    /** delisted | relisted | probe_pass_to_fail | settle_drop */
    eventType: text("event_type").notNull(),
    /** 'YYYY-MM-DD' */
    detectedOn: text("detected_on").notNull(),
    prevValue: jsonb("prev_value"),
    newValue: jsonb("new_value"),
    /** Set TRUE after webhook delivery to the claiming payee — the double-send guard. */
    notified: boolean("notified").notNull().default(false),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("x402_delisting_events_endpoint_idx").on(t.endpointId),
    index("x402_delisting_events_detected_idx").on(t.detectedOn),
  ],
);

/**
 * Observatory watchers (design §6.1) — the claim join, made explicit. A row
 * binds a RECEIVING wallet to an api key, created only through
 * POST /api/v1/observatory/watch where the caller signs the canonical
 * observatoryWatchMessage with that wallet (EIP-191 — the same
 * proof-of-control gate verified payees use). Delisting events whose
 * endpoint.payTo equals `wallet` are delivered to the key's webhooks as
 * `endpoint.delisted` through the existing HMAC/SSRF/auto-disable stack.
 */
export const x402PayeeWatchers = pgTable(
  "x402_payee_watchers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Lowercased receiving wallet — matches x402_endpoints.pay_to (also lowercased). */
    wallet: text("wallet").notNull(),
    apiKeyId: uuid("api_key_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("x402_payee_watchers_wallet_key_unique").on(t.wallet, t.apiKeyId),
    index("x402_payee_watchers_wallet_idx").on(t.wallet),
  ],
);
