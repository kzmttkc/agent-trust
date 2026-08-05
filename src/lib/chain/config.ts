/**
 * ERC-8004 deterministic CREATE2 addresses (identical on all EVM mainnets).
 * @see https://github.com/erc-8004/erc-8004-contracts
 */
export const BASE_CHAIN_ID = 8453;

export const ERC8004_ADDRESSES = {
  identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const,
  reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as const,
  validationRegistry: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58" as const,
} as const;

/**
 * Circle's native USDC on Base mainnet — the settlement currency of x402
 * payments. Drain-pattern checks aggregate this token alongside native ETH;
 * deliberately not a general ERC20 allowlist (x402 settles in USDC only).
 * @see https://developers.circle.com/stablecoins/usdc-on-main-networks
 */
export const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

export const SCORE_THRESHOLDS = {
  allow: 70,
  warn: 40,
} as const;

export const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Owner-index staleness threshold for SCORING (2026-08-05 R&D).
 * Base produces a block every ~2s, so 43,200 blocks is roughly one day of
 * lag. Below this, the index is fresh enough that multi_agent_owner /
 * funding-cluster checks are trustworthy; above it, recently registered
 * agents may be invisible to those checks, so the engine adds a SOFT
 * `owner_index_stale` flag — the data exists but may miss the newest
 * registrations, which is a different (and milder) failure than
 * owner_count_unavailable, where the read itself failed.
 * The monitor's own alert threshold (500,000 in uptime-cron) is about
 * paging a human; this one is about being honest inside the score.
 */
export const OWNER_INDEX_STALE_BLOCKS = 43_200;
/** Aligned with score cache so wallet metrics cannot outlive chain score freshness. */
export const WALLET_METRICS_CACHE_TTL_MS = CACHE_TTL_MS;

/** Base block when ERC-8004 Identity Registry was deployed (verified on-chain). */
export const IDENTITY_REGISTRY_FROM_BLOCK = BigInt(41_663_783);

/**
 * Chain signal weights before manual WL/BL policy.
 * Manual remains a post-score policy layer (not mixed into this sum).
 * x402 settlement history starts at 10% (Phase 1.5); wallet reduced from 0.30 → 0.20.
 */
export const SCORE_WEIGHTS = {
  identity: 0.2,
  reputation: 0.3,
  wallet: 0.2,
  x402: 0.1,
  /** Policy layer — not included in computeWeightedScore. */
  manual: 0.2,
} as const;
