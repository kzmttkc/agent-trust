export type Recommendation = "ALLOW" | "WARN" | "BLOCK";

export type DataCoverage = {
  ownerIndexer: {
    status: "synced" | "partial" | "unavailable";
    blocksBehind: number | null;
    lastBlock: string | null;
    indexedAgentRows: number;
    /** True when recent Transfers may not yet be reflected for enforcement. */
    staleRisk: boolean;
  };
  settlement: {
    /** Attested x402 payment rows in store (global). */
    paymentRows: number;
    distinctWallets: number;
    recentPayments30d: number;
    /** True when the wallet being scored has at least one attestation. */
    walletHasHistory: boolean;
  };
};

export type TrustSignals = {
  identity: {
    registered: boolean;
    hasMetadataUri: boolean;
  };
  reputation: {
    feedbackCount: number;
    /** Internal 0–100 reputation component used in scoring. */
    avgScore: number;
    /** Raw on-chain average from the reputation registry summary. */
    onChainAvgScore: number;
  };
  wallet: {
    ageDays: number;
    txCount: number;
    isBurner: boolean;
  };
  x402: {
    paymentCount: number;
    uniqueDays: number;
    /** Internal 0–100 settlement component used in scoring. */
    score: number;
  };
  sybil: {
    risk: "low" | "medium" | "high";
    flags: string[];
  };
  manual: {
    list: "none" | "whitelist" | "blacklist";
  };
};

export type TrustScoreResult = {
  agentId: string;
  wallet: string | null;
  trustScore: number;
  recommendation: Recommendation;
  signals: TrustSignals;
  scoredAt: string;
  cacheExpiresAt: string;
  disclaimer: string;
  blockReason?: string;
  /** True when customer whitelist/blacklist changed the outcome. */
  manualOverride?: boolean;
  /** Indexer / chain data freshness — scores are valid for synced ranges. */
  dataCoverage?: DataCoverage;
};

export type ScoreRequestContext = {
  apiKeyId?: string;
  verifyWallet?: string;
  /** EVM chain id for the ERC-8004 reads. Default (and today the only chain
   *  with settlement + full wallet metrics) is Base — see chain/chains.ts. */
  chainId?: number;
};
