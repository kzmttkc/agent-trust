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

export const SCORE_THRESHOLDS = {
  allow: 70,
  warn: 40,
} as const;

export const CACHE_TTL_MS = 5 * 60 * 1000;
/** Aligned with score cache so wallet metrics cannot outlive chain score freshness. */
export const WALLET_METRICS_CACHE_TTL_MS = CACHE_TTL_MS;

/** Base block when ERC-8004 Identity Registry was deployed (verified on-chain). */
export const IDENTITY_REGISTRY_FROM_BLOCK = BigInt(41_663_783);

export const SCORE_WEIGHTS = {
  identity: 0.2,
  reputation: 0.3,
  wallet: 0.3,
  manual: 0.2,
  x402: 0,
} as const;
