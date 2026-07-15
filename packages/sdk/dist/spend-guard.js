const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
function assertPolicy(policy) {
    for (const key of ["maxPerTxUsd", "dailyBudgetUsd", "minPayeeScore"]) {
        const value = policy[key];
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
            throw new Error(`invalid_policy_${key}`);
        }
    }
    if (policy.minPayeeScore !== undefined && policy.minPayeeScore > 100) {
        throw new Error("invalid_policy_minPayeeScore");
    }
}
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
export class SpendGuard {
    policy;
    fetchPayeeScore;
    now;
    spentTodayUsd = 0;
    currentDay;
    constructor(policy, fetchPayeeScore, now = () => new Date()) {
        assertPolicy(policy);
        this.policy = { ...policy };
        this.fetchPayeeScore = fetchPayeeScore;
        this.now = now;
        this.currentDay = this.utcDay();
    }
    async evaluate(input) {
        if (!WALLET_RE.test(input.payee))
            throw new Error("invalid_payee_address");
        if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) {
            throw new Error("invalid_amount_usd");
        }
        this.rollDayIfNeeded();
        const reasons = [];
        const { maxPerTxUsd, dailyBudgetUsd, minPayeeScore, blockOnRecommendation } = this.policy;
        if (maxPerTxUsd !== undefined && input.amountUsd > maxPerTxUsd) {
            reasons.push("max_per_tx_exceeded");
        }
        if (dailyBudgetUsd !== undefined &&
            this.spentTodayUsd + input.amountUsd > dailyBudgetUsd) {
            reasons.push("daily_budget_exceeded");
        }
        // Optimistic reservation: once the local rules pass, take the amount out
        // of today's budget BEFORE the trust lookup yields to the event loop.
        // Otherwise two concurrent evaluate() calls could both read the same
        // pre-reservation counter while their lookups were in flight and jointly
        // overshoot the budget (TOCTOU). A trust-rule deny returns it below.
        let reserved = false;
        if (reasons.length === 0) {
            this.spentTodayUsd += input.amountUsd;
            reserved = true;
        }
        let payeeScore = null;
        const needsTrustLookup = minPayeeScore !== undefined || blockOnRecommendation === true;
        if (needsTrustLookup && reasons.length === 0) {
            try {
                payeeScore = await this.fetchPayeeScore(input.payee);
            }
            catch {
                reasons.push("payee_trust_unavailable");
            }
            if (payeeScore) {
                if (minPayeeScore !== undefined && payeeScore.score < minPayeeScore) {
                    reasons.push("payee_score_below_min");
                }
                if (blockOnRecommendation === true && payeeScore.recommendation === "BLOCK") {
                    reasons.push("payee_recommendation_block");
                }
            }
        }
        const allow = reasons.length === 0;
        if (!allow && reserved) {
            // Trust rules denied after the optimistic reservation — give it back.
            // rollDayIfNeeded first: if the UTC day flipped while the lookup was in
            // flight, the counter was already reset and the release must clamp at 0
            // instead of dragging the fresh day's counter negative.
            this.rollDayIfNeeded();
            this.spentTodayUsd = Math.max(0, this.spentTodayUsd - input.amountUsd);
        }
        return {
            allow,
            reasons,
            payee: input.payee,
            amountUsd: input.amountUsd,
            spentTodayUsd: this.spentTodayUsd,
            remainingDailyBudgetUsd: dailyBudgetUsd !== undefined
                ? Math.max(0, dailyBudgetUsd - this.spentTodayUsd)
                : null,
            payeeScore,
        };
    }
    /**
     * Returns a previously reserved amount to today's budget. Call when an
     * allowed payment ultimately did not execute.
     */
    release(amountUsd) {
        if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
            throw new Error("invalid_amount_usd");
        }
        this.rollDayIfNeeded();
        this.spentTodayUsd = Math.max(0, this.spentTodayUsd - amountUsd);
    }
    /** Current in-memory budget state (UTC day + reserved USD). */
    state() {
        this.rollDayIfNeeded();
        return { day: this.currentDay, spentTodayUsd: this.spentTodayUsd };
    }
    rollDayIfNeeded() {
        const day = this.utcDay();
        if (day !== this.currentDay) {
            this.currentDay = day;
            this.spentTodayUsd = 0;
        }
    }
    utcDay() {
        return this.now().toISOString().slice(0, 10);
    }
}
