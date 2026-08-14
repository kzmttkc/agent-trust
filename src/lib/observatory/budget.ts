// ============================================================
// vet402 Observatory — L1 purchasing budget guard SKELETON (design §8).
//
// NO CALLER EXISTS. Real purchasing is W3, a separate work order, gated on
// funding approval. This guard ships ahead of it so that purchasing code has
// to pass an already-tested fail-closed gate on day one instead of growing
// its own under deadline pressure.
//
// Fail-closed, concretely:
//   - OFF unless OBSERVATORY_L1_ENABLED is the exact string "true";
//   - denied on NaN / negative / zero amounts (malformed input is not a
//     reason to spend money);
//   - denied when spend-so-far + request would exceed the daily cap.
// The $25/day cap is the WO figure. Spend tracking (where spentTodayUsd
// comes from) is W3's job — this module judges, it does not count.
// ============================================================

export const DAILY_BUDGET_USD = 25;

export function isL1Enabled(): boolean {
  return process.env.OBSERVATORY_L1_ENABLED === "true";
}

export type BudgetDecision =
  | { allowed: true }
  | { allowed: false; reason: "l1_disabled" | "invalid_amount" | "daily_budget_exceeded" };

export function checkL1Budget(input: {
  /** USD already spent today (caller-supplied from the spend ledger, W3). */
  spentTodayUsd: number;
  /** USD this purchase would cost. */
  requestUsd: number;
}): BudgetDecision {
  if (!isL1Enabled()) return { allowed: false, reason: "l1_disabled" };

  const { spentTodayUsd, requestUsd } = input;
  if (!Number.isFinite(spentTodayUsd) || spentTodayUsd < 0) {
    return { allowed: false, reason: "invalid_amount" };
  }
  if (!Number.isFinite(requestUsd) || requestUsd <= 0) {
    return { allowed: false, reason: "invalid_amount" };
  }
  if (spentTodayUsd + requestUsd > DAILY_BUDGET_USD) {
    return { allowed: false, reason: "daily_budget_exceeded" };
  }
  return { allowed: true };
}
