export type TrustScoreResult = {
    agentId: string;
    wallet: string | null;
    trustScore: number;
    recommendation: "ALLOW" | "WARN" | "BLOCK";
    signals: {
        identity: {
            registered: boolean;
            hasMetadataUri: boolean;
        };
        reputation: {
            feedbackCount: number;
            avgScore: number;
            onChainAvgScore: number;
        };
        wallet: {
            ageDays: number;
            txCount: number;
            isBurner: boolean;
        };
        x402?: {
            paymentCount: number;
            uniqueDays: number;
            score: number;
        };
        sybil: {
            risk: string;
            flags: string[];
        };
        manual: {
            list: string;
        };
    };
    scoredAt: string;
    cacheExpiresAt: string;
    disclaimer: string;
    blockReason?: string;
    manualOverride?: boolean;
};
export type VouchClientConfig = {
    apiUrl: string;
    apiKey: string;
};
export declare function fetchAgentScore(agentId: string, wallet?: string): Promise<TrustScoreResult>;
export declare function fetchWalletScore(wallet: string): Promise<TrustScoreResult>;
