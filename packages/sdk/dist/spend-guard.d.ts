import type { PayeeScoreResult } from "./index.js";
export type SpendGuardPolicy = {
    /** Deny any single payment above this USD amount. */
    maxPerTxUsd?: number;
    /**
     * Deny once cumulative allowed payments in the current UTC day would
     * exceed this USD amount. The counter lives in this process's memory and
     * resets on process restart — see README for the operational implications.
     */
    dailyBudgetUsd?: number;
    /** Deny when the Vouch payee score is below this value (0-100). */
    minPayeeScore?: number;
    /** Deny when the Vouch payee recommendation is BLOCK. */
    blockOnRecommendation?: boolean;
};
export type SpendEvaluateInput = {
    /** Payee wallet address (0x...) the agent is about to pay. */
    payee: string;
    /** Payment amount in USD. */
    amountUsd: number;
};
export type SpendDenyReason = "max_per_tx_exceeded" | "daily_budget_exceeded" | "payee_score_below_min" | "payee_recommendation_block" | "payee_trust_unavailable";
export type SpendDecision = {
    allow: boolean;
    /** Empty when allowed; one or more machine-readable codes when denied. */
    reasons: SpendDenyReason[];
    payee: string;
    amountUsd: number;
    /**
     * Cumulative USD counted against today's budget after this decision
     * (includes this payment when allowed).
     */
    spentTodayUsd: number;
    /** null when the policy has no dailyBudgetUsd. */
    remainingDailyBudgetUsd: number | null;
    /**
     * Full payee trust result when the policy required a Vouch lookup and it
     * succeeded; null when the lookup was skipped (no trust rule in the
     * policy, or a cheaper local rule already denied) or failed.
     */
    payeeScore: PayeeScoreResult | null;
};
/**
 * Non-custodial spend-policy layer: answers "may my agent send this payment?"
 * and nothing else. It never touches keys, funds, signing, or transaction
 * submission — execution stays with the agent's own wallet stack (Coinbase
 * AgentKit, Privy, ...). The guard composes:
 *
 * 1. Local policy — per-transaction cap and an in-memory daily budget
 *    counter (UTC day, resets on process restart).
 * 2. Vouch's Payee Trust API (`GET /v1/payees/{address}/score`) — only
 *    consulted when the policy sets `minPayeeScore` or
 *    `blockOnRecommendation`, and skipped when a local rule already denied
 *    (no quota burned on a payment that's dead anyway).
 *
 * Trust-lookup failures deny with `payee_trust_unavailable` (fail-closed),
 * matching the rest of Vouch's fail-closed posture.
 *
 * Budget reservation is optimistic: once the local rules pass, the amount is
 * reserved against the daily budget BEFORE the trust lookup yields to the
 * event loop, and returned automatically if the trust rules then deny. This
 * keeps concurrent in-process `evaluate` calls honest — two payments racing
 * through the same guard cannot both read the pre-reservation counter and
 * slip past the budget together. If the agent ultimately does NOT execute an
 * allowed payment, call `release(amountUsd)` to return the reservation.
 */
export declare class SpendGuard {
    private readonly policy;
    private readonly fetchPayeeScore;
    private readonly now;
    private spentTodayUsd;
    private currentDay;
    constructor(policy: SpendGuardPolicy, fetchPayeeScore: (payee: string) => Promise<PayeeScoreResult>, now?: () => Date);
    evaluate(input: SpendEvaluateInput): Promise<SpendDecision>;
    /**
     * Returns a previously reserved amount to today's budget. Call when an
     * allowed payment ultimately did not execute.
     */
    release(amountUsd: number): void;
    /** Current in-memory budget state (UTC day + reserved USD). */
    state(): {
        day: string;
        spentTodayUsd: number;
    };
    private rollDayIfNeeded;
    private utcDay;
}
