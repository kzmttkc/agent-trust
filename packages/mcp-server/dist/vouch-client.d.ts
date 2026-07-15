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
            status: string;
            blocksBehind: number | null;
            lastBlock?: string | null;
            indexedAgentRows?: number;
            staleRisk: boolean;
        };
        settlement: {
            paymentRows: number;
            distinctWallets?: number;
            recentPayments30d?: number;
            walletHasHistory: boolean;
        };
    };
};
export type PayeeScoreResult = {
    payee: string;
    score: number;
    recommendation: "ALLOW" | "WARN" | "BLOCK";
    dataDepth: "thin" | "moderate" | "rich";
    signals: {
        receiving: {
            paymentCount: number;
            uniqueDays: number;
            distinctPayers: number;
            score: number;
        };
        walletHealth: {
            ageDays: number;
            txCount: number;
            isBurner: boolean;
            score: number;
        };
        drainPattern: {
            detected: boolean;
            drainRatio: number | null;
            outgoingCount: number;
            incomingCount: number;
            score: number;
        };
        outcomeHistory: {
            types: string[];
            adjustment: number;
        };
        flags: string[];
    };
    scoredAt: string;
    cacheExpiresAt: string;
    disclaimer: string;
};
export type VouchClientConfig = {
    apiUrl: string;
    apiKey: string;
};
export type X402PaymentAttestation = {
    wallet: string;
    txHash: string;
    amount?: string;
    network?: string;
    resource?: string;
};
export declare class VouchApiError extends Error {
    /** Present for some error codes (e.g. attestation_unverifiable) with a human-readable detail. */
    reason?: string;
    constructor(code: string, reason?: string);
}
export declare function fetchAgentScore(agentId: string, wallet?: string): Promise<TrustScoreResult>;
export declare function fetchWalletScore(wallet: string): Promise<TrustScoreResult>;
/** Buyer-side lookup: scores the payment *recipient* before an agent pays it. */
export declare function fetchPayeeScore(payee: string): Promise<PayeeScoreResult>;
export declare function attestX402Payment(attestation: X402PaymentAttestation): Promise<{
    ok: boolean;
    created: boolean;
    id: string;
}>;
