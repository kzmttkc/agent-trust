import Stripe from "stripe";
import { BILLING_PLANS, type PaidPlan } from "./plans";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(key);
  }

  return stripeClient;
}

export async function createCheckoutSession(params: {
  accountId: string;
  email: string;
  plan: PaidPlan;
  customerId?: string | null;
}): Promise<{ url: string; customerId: string }> {
  const stripe = getStripe();
  const priceId = BILLING_PLANS[params.plan].stripePriceId();
  if (!priceId) {
    throw new Error("stripe_price_not_configured");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  let customerId = params.customerId ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: params.email,
      metadata: { accountId: params.accountId },
    });
    customerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard/billing?checkout=success`,
    cancel_url: `${appUrl}/dashboard/billing?checkout=cancelled`,
    metadata: { accountId: params.accountId, plan: params.plan },
    subscription_data: {
      metadata: { accountId: params.accountId, plan: params.plan },
    },
  });

  if (!session.url) {
    throw new Error("stripe_checkout_failed");
  }

  return { url: session.url, customerId };
}

/**
 * Thrown when an existing subscription can't be changed in place (e.g. it was
 * canceled) — callers should fall back to creating a fresh checkout session.
 */
export class SubscriptionNotChangeableError extends Error {
  constructor() {
    super("subscription_not_changeable");
  }
}

/**
 * Swap the price on an already-active subscription instead of creating a new
 * Checkout Session, which would otherwise leave the customer with two
 * concurrent subscriptions (double billing) when switching plans.
 */
export async function changeSubscriptionPlan(params: {
  subscriptionId: string;
  plan: PaidPlan;
}): Promise<{ subscriptionId: string }> {
  const stripe = getStripe();
  const priceId = BILLING_PLANS[params.plan].stripePriceId();
  if (!priceId) {
    throw new Error("stripe_price_not_configured");
  }

  const subscription = await stripe.subscriptions.retrieve(params.subscriptionId);
  if (subscription.status !== "active" && subscription.status !== "trialing") {
    throw new SubscriptionNotChangeableError();
  }

  const itemId = subscription.items.data[0]?.id;
  if (!itemId) {
    throw new SubscriptionNotChangeableError();
  }

  const updated = await stripe.subscriptions.update(params.subscriptionId, {
    items: [{ id: itemId, price: priceId }],
    proration_behavior: "create_prorations",
    metadata: { ...subscription.metadata, plan: params.plan },
  });

  return { subscriptionId: updated.id };
}

export async function createBillingPortalSession(customerId: string): Promise<string> {
  const stripe = getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/dashboard/billing`,
  });

  return session.url;
}
