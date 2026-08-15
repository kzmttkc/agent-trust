import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { planFromStripePriceId } from "@/lib/billing/plans";
import { resolveAccountPlanFromStripe } from "@/lib/billing/subscription-status";
import { getStripe } from "@/lib/billing/stripe";
import {
  getAccountByStripeCustomerId,
  setAccountStripeIds,
  updateAccountPlan,
} from "@/lib/db/accounts";

export const runtime = "nodejs";

async function applyPlanFromSubscription(subscription: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const account = await getAccountByStripeCustomerId(customerId);
  if (!account) return;

  const priceId = subscription.items.data[0]?.price.id;
  const plan = priceId ? planFromStripePriceId(priceId) : null;
  const resolved = resolveAccountPlanFromStripe({
    stripeStatus: subscription.status,
    pricePlan: plan,
  });

  await updateAccountPlan(account.id, resolved.plan);
  await setAccountStripeIds(account.id, {
    stripeSubscriptionId: resolved.health === "canceled" ? null : subscription.id,
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const accountId = session.metadata?.accountId;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;

      if (accountId && customerId) {
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : null;

        await setAccountStripeIds(accountId, {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
        });

        // Derive plan from Stripe price ID — never trust session.metadata.plan alone.
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await applyPlanFromSubscription(subscription);
        }
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await applyPlanFromSubscription(subscription);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (!customerId) break;
      const failedAccount = await getAccountByStripeCustomerId(customerId);
      if (!failedAccount?.stripeSubscriptionId) break;
      const subscription = await stripe.subscriptions.retrieve(failedAccount.stripeSubscriptionId);
      await applyPlanFromSubscription(subscription);
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
