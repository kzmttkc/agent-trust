import type { PaidPlan } from "./plans";

export type BillingHealth = "ok" | "past_due" | "canceled";
export type StoredPlan = "free" | PaidPlan;
export type CheckoutDisposition = "change_in_place" | "new_checkout" | "use_portal";

/**
 * Whether Billing may open a new Checkout Session, swap the existing
 * subscription's price, or must send the customer to the portal.
 *
 * A subscription that Stripe is still retrying (`past_due`) or has not
 * finished (`incomplete` / `unpaid` / `paused`) is not canceled. Opening
 * Checkout in that window creates a second subscription and double-bills.
 */
export function checkoutDisposition(
  stripeStatus: string | null | undefined,
): CheckoutDisposition {
  if (!stripeStatus) return "new_checkout";
  if (stripeStatus === "active" || stripeStatus === "trialing") return "change_in_place";
  if (stripeStatus === "canceled" || stripeStatus === "incomplete_expired") {
    return "new_checkout";
  }
  return "use_portal";
}

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
