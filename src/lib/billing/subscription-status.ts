import type { PaidPlan } from "./plans";

export type BillingHealth = "ok" | "past_due" | "canceled";
export type StoredPlan = "free" | PaidPlan;

/**
 * Map a Stripe subscription status onto the plan we should store and the
 * banner the billing page should show.
 *
 * past_due keeps the paid plan: Stripe is retrying the card. Dropping quota
 * in that window is silent punishment. canceled / unpaid / incomplete_expired
 * drop to free.
 */
export function resolveAccountPlanFromStripe(input: {
  stripeStatus: string;
  pricePlan: StoredPlan | null;
}): { plan: StoredPlan; health: BillingHealth } {
  const priced = input.pricePlan ?? "free";

  if (input.stripeStatus === "active" || input.stripeStatus === "trialing") {
    return { plan: priced, health: "ok" };
  }

  if (input.stripeStatus === "past_due") {
    return { plan: priced, health: "past_due" };
  }

  return { plan: "free", health: "canceled" };
}
