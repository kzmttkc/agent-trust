export type Recommendation = "ALLOW" | "WARN" | "BLOCK";
export type TrustScoreResult = {
    agentId: string;
    wallet: string | null;
    trustScore: number;
    recommendation: Recommendation;
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
        x402: {
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
    dataCoverage?: {
        ownerIndexer: {
            status: "synced" | "partial" | "unavailable";
            blocksBehind: number | null;
            lastBlock: string | null;
            indexedAgentRows: number;
            staleRisk: boolean;
        };
        settlement: {
            paymentRows: number;
            distinctWallets: number;
            recentPayments30d: number;
            walletHasHistory: boolean;
        };
    };
};
export type VouchClientOptions = {
    apiUrl: string;
    apiKey: string;
    fetch?: typeof fetch;
};
export type X402PaymentAttestation = {
    wallet: string;
    txHash: string;
    amount?: string;
    network?: string;
    resource?: string;
};
export type BatchScoreItem = {
    agentId: string;
    wallet?: string;
} | {
    wallet: string;
    agentId?: never;
};
export declare class VouchClient {
    private readonly apiUrl;
    private readonly apiKey;
    private readonly fetchFn;
    constructor(options: VouchClientOptions);
    getAgentScore(agentId: string, wallet?: string): Promise<TrustScoreResult>;
    getWalletScore(wallet: string): Promise<TrustScoreResult>;
    batchScore(agents: BatchScoreItem[]): Promise<{
        results: unknown[];
    }>;
    attestX402Payment(attestation: X402PaymentAttestation): Promise<{
        ok: boolean;
        created: boolean;
        id: string;
    }>;
    private request;
}
export declare function createVouchClient(options: VouchClientOptions): VouchClient;
