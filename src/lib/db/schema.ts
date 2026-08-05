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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("x402_payments_tx_hash_idx").on(t.txHash),
    index("x402_payments_wallet_created_idx").on(t.wallet, t.createdAt),
    index("x402_payments_api_key_idx").on(t.apiKeyId),
    index("x402_payments_payee_created_idx").on(t.payee, t.createdAt),
  ],
);
