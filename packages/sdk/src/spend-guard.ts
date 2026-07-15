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

export type SpendDenyReason =
  | "max_per_tx_exceeded"
  | "daily_budget_exceeded"
  | "payee_score_below_min"
  | "payee_recommendation_block"
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
   * Full payee trust result when the policy required a Vouch lookup and it
   * succeeded; null when the lookup was skipped (no trust rule in the
   * policy, or a cheaper local rule already denied) or failed.
   */
  payeeScore: PayeeScoreResult | null;
};

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

function assertPolicy(policy: SpendGuardPolicy): void {
  for (const key of ["maxPerTxUsd", "dailyBudgetUsd", "minPayeeScore"] as const) {
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
  private readonly policy: SpendGuardPolicy;
  private readonly fetchPayeeScore: (payee: string) => Promise<PayeeScoreResult>;
  private readonly now: () => Date;
  private spentTodayUsd = 0;
  private currentDay: string;

  constructor(
    policy: SpendGuardPolicy,
    fetchPayeeScore: (payee: string) => Promise<PayeeScoreResult>,
    now: () => Date = () => new Date(),
  ) {
    assertPolicy(policy);
    this.policy = { ...policy };
    this.fetchPayeeScore = fetchPayeeScore;
    this.now = now;
    this.currentDay = this.utcDay();
  }

  async evaluate(input: SpendEvaluateInput): Promise<SpendDecision> {
    if (!WALLET_RE.test(input.payee)) throw new Error("invalid_payee_address");
    if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) {
      throw new Error("invalid_amount_usd");
    }

    this.rollDayIfNeeded();

    const reasons: SpendDenyReason[] = [];
    const { maxPerTxUsd, dailyBudgetUsd, minPayeeScore, blockOnRecommendation } = this.policy;

    if (maxPerTxUsd !== undefined && input.amountUsd > maxPerTxUsd) {
      reasons.push("max_per_tx_exceeded");
    }
    if (
      dailyBudgetUsd !== undefined &&
      this.spentTodayUsd + input.amountUsd > dailyBudgetUsd
    ) {
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

    let payeeScore: PayeeScoreResult | null = null;
    const needsTrustLookup =
      minPayeeScore !== undefined || blockOnRecommendation === true;

    if (needsTrustLookup && reasons.length === 0) {
      try {
        payeeScore = await this.fetchPayeeScore(input.payee);
      } catch {
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
      remainingDailyBudgetUsd:
        dailyBudgetUsd !== undefined
          ? Math.max(0, dailyBudgetUsd - this.spentTodayUsd)
          : null,
      payeeScore,
    };
  }

  /**
   * Returns a previously reserved amount to today's budget. Call when an
   * allowed payment ultimately did not execute.
   */
  release(amountUsd: number): void {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new Error("invalid_amount_usd");
    }
    this.rollDayIfNeeded();
    this.spentTodayUsd = Math.max(0, this.spentTodayUsd - amountUsd);
  }

  /** Current in-memory budget state (UTC day + reserved USD). */
  state(): { day: string; spentTodayUsd: number } {
    this.rollDayIfNeeded();
    return { day: this.currentDay, spentTodayUsd: this.spentTodayUsd };
  }

  private rollDayIfNeeded(): void {
    const day = this.utcDay();
    if (day !== this.currentDay) {
      this.currentDay = day;
      this.spentTodayUsd = 0;
    }
  }

  private utcDay(): string {
    return this.now().toISOString().slice(0, 10);
  }
}
