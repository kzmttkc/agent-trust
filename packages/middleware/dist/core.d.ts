export type Recommendation = "ALLOW" | "WARN" | "BLOCK";
/** What the gate decided to do with the transaction. */
export type GateAction = "allow" | "warn" | "block";
/**
 * Which score endpoint to consult for the counterparty.
 *  - "wallet": GET /wallets/{addr}/score — the x402 beacon the facilitator
 *    gate and the x402-trust-gate example already use. Default.
 *  - "payee":  GET /payees/{addr}/score — buyer-side "should my agent pay this
 *    receiving wallet?" (settlement history, drain-pattern, outcome labels).
 */
export type ScoreSource = "wallet" | "payee";
/** Behaviour when the score lookup itself fails (network, 5xx, timeout). */
export type FailMode = "closed" | "open";
/**
 * How the recommendation gates the transaction. BREAKING (0.2.0): the default
 * is "allow-only" — money moves only on ALLOW unless you explicitly opt out.
 *
 *  - "allow-only" (default, fail-closed): anything that is not ALLOW blocks.
 *    A WARN blocks with reason `recommendation_not_allow`.
 *  - "block-only": pre-0.2.0 behaviour — BLOCK blocks, WARN warns but is
 *    allowed downstream.
 *  - "custom": band with your own `blockOn` / `warnOn` arrays.
 */
export type GatePolicy = "allow-only" | "block-only" | "custom";
export type VouchGateConfig = {
    /** Base URL including the version segment, e.g. https://host/api/v1 */
    apiUrl: string;
    apiKey: string;
    /** Score endpoint to consult. Default "wallet". */
    scoreSource?: ScoreSource;
    /**
     * Verdict gating policy. Default "allow-only" (fail-closed): only ALLOW
     * passes. See GatePolicy for the explicit opt-outs.
     */
    policy?: GatePolicy;
    /** Recommendations that BLOCK the transaction. Requires policy "custom". */
    blockOn?: Recommendation[];
    /** Recommendations that WARN (allowed, but flagged). Requires policy "custom". */
    warnOn?: Recommendation[];
    /**
     * Optional stricter floor: BLOCK when the numeric score is below this
     * (0-100), even if the recommendation would have allowed. This is the
     * integrator's own risk appetite layered on top of the engine's banding.
     */
    minScore?: number;
    /**
     * What to do when the score cannot be fetched. Default "closed" — a
     * payment whose counterparty we cannot vet is not settled. Set "open" only
     * if availability matters more than the trust check for your route.
     */
    failMode?: FailMode;
    /** Injectable fetch (tests / custom transport). Defaults to global fetch. */
    fetch?: typeof fetch;
    /** Score-lookup timeout in ms. Default 5000. */
    timeoutMs?: number;
};
export type GateDecision = {
    action: GateAction;
    /** null when the lookup failed and the verdict came from failMode. */
    recommendation: Recommendation | null;
    /** null when the lookup failed. */
    score: number | null;
    address: string;
    /** Stable machine-readable reason for the action. */
    reason: string;
    /** true when the decision came from failMode, not a real score. */
    degraded: boolean;
};
export type X402PaymentAttestation = {
    wallet: string;
    txHash: string;
    amount?: string;
    network?: string;
    resource?: string;
};
/** Raised for programming errors (bad address/config) — never for a BLOCK. */
export declare class VouchGateError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
export type TrustGate = {
    /**
     * Score a counterparty address and decide ALLOW / WARN / BLOCK. Never
     * throws for a normal verdict — only for an invalid address (a caller bug,
     * not a trust degradation). A failed lookup resolves per failMode.
     */
    evaluate(address: string): Promise<GateDecision>;
    /**
     * Attest a settled x402 payment back to Vouch so future scores can weight
     * it (10% of the score). Fire-and-forget from a gate: resolves false on any
     * failure instead of throwing, so a settlement is never rolled back just
     * because the attestation POST failed.
     */
    attest(attestation: X402PaymentAttestation): Promise<boolean>;
    /** The resolved, validated config (defaults applied). */
    readonly config: ResolvedGateConfig;
};
export type ResolvedGateConfig = {
    apiUrl: string;
    scoreSource: ScoreSource;
    policy: GatePolicy;
    blockOn: Recommendation[];
    warnOn: Recommendation[];
    minScore: number | null;
    failMode: FailMode;
    timeoutMs: number;
};
export declare function createTrustGate(config: VouchGateConfig): TrustGate;
