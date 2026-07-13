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
};
