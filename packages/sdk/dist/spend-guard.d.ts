import type { PayeeScoreResult } from "./index.js";
/**
 * Trust posture toward the payee score. BREAKING (0.2.0): the default is
 * "allow-only" — money moves only on a clean ALLOW unless you explicitly
 * opt out.
 *
 *  - "allow-only" (default, fail-closed): every evaluate() performs the payee
 *    trust lookup and denies unless the verdict is a clean ALLOW — a WARN or
 *    BLOCK recommendation, a degraded read, a partial measurement
 *    (signalsUnavailable non-empty), or a failed lookup all deny.
 *  - "block-only": the lookup still always runs and a failed or degraded read
 *    still denies, but a WARN (or partially measured) verdict passes. Deny
 *    only on BLOCK.
 *  - "custom": pre-0.2.0 behaviour — only the rules you set below apply, and
 *    the lookup runs only when `minPayeeScore` or `blockOnRecommendation`
 *    is set.
 */
export type SpendGuardTrustPolicy = "allow-only" | "block-only" | "custom";
export type SpendGuardPolicy = {
    /** Deny any single payment above this USD amount. */
    maxPerTxUsd?: number;
    /**
     * Deny once cumulative allowed payments in the current UTC day would
     * exceed this USD amount. The counter lives in this process's memory and
     * resets on process restart — see README for the operational implications.
     */
    dailyBudgetUsd?: number;
    /**
     * How the Vouch payee verdict gates the payment. Default "allow-only"
     * (fail-closed): deny everything that is not a clean ALLOW. See
     * SpendGuardTrustPolicy for the explicit opt-outs.
     */
    trustPolicy?: SpendGuardTrustPolicy;
    /** Deny when the Vouch payee score is below this value (0-100). */
    minPayeeScore?: number;
    /**
     * Deny when the Vouch payee recommendation is BLOCK. Kept for backward
     * compatibility: under the default "allow-only" policy this is already
     * implied (anything that is not ALLOW denies). It remains meaningful with
     * `trustPolicy: "custom"`.
     */
    blockOnRecommendation?: boolean;
};
export type SpendEvaluateInput = {
    /** Payee wallet address (0x...) the agent is about to pay. */
    payee: string;
    /** Payment amount in USD. */
    amountUsd: number;
};
export type SpendDenyReason = "max_per_tx_exceeded" | "daily_budget_exceeded" | "payee_score_below_min"
/** Recommendation was WARN or BLOCK under the default "allow-only" policy. */
 | "payee_recommendation_not_allow" | "payee_recommendation_block"
/** The score itself came from a degraded read (inputs missing entirely). */
 | "payee_score_degraded"
/** Some inputs could not be measured (signalsUnavailable non-empty). */
 | "payee_partial_measurement"
/** The score lookup itself failed (network, 5xx, timeout). */
 | "payee_trust_unavailable";
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
     * Full payee trust result when the Vouch lookup ran and succeeded; null
     * when the lookup was skipped (a cheaper local rule already denied, or
     * `trustPolicy: "custom"` with no trust rule set) or failed.
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
 * 2. Vouch's Payee Trust API (`GET /v1/payees/{address}/score`) — consulted
 *    on every evaluate under the default fail-closed policy (skipped when a
 *    local rule already denied, so no quota is burned on a payment that's
 *    dead anyway). Only `trustPolicy: "custom"` makes the lookup conditional
 *    on `minPayeeScore` / `blockOnRecommendation` being set.
 *
 * BREAKING (0.2.0) — fail-closed by default (`trustPolicy: "allow-only"`):
 * a WARN or BLOCK recommendation, a degraded read, a partial measurement,
 * or a failed lookup all deny. Money moves only on a clean ALLOW unless the
 * integrator explicitly opts out via `trustPolicy`.
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
