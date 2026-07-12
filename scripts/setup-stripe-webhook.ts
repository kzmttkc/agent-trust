/**
 * Register Stripe webhook for Vouch billing.
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... NEXT_PUBLIC_APP_URL=https://your-app.vercel.app \
 *     npx tsx scripts/setup-stripe-webhook.ts
 */
import Stripe from "stripe";

const EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!key) throw new Error("STRIPE_SECRET_KEY is required");
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is required");

  const stripe = new Stripe(key);
  const url = `${appUrl.replace(/\/$/, "")}/api/billing/webhook`;

  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  const match = existing.data.find((endpoint) => endpoint.url === url);
  if (match) {
    console.log(JSON.stringify({
      ok: true,
      existing: true,
      url: match.url,
      note: "STRIPE_WEBHOOK_SECRET cannot be retrieved for existing endpoints; create a new one in Dashboard if missing.",
    }, null, 2));
    return;
  }

  const endpoint = await stripe.webhookEndpoints.create({
    url,
    enabled_events: EVENTS,
    description: "Vouch billing (agent-trust)",
  });

  console.log(JSON.stringify({
    ok: true,
    url: endpoint.url,
    STRIPE_WEBHOOK_SECRET: endpoint.secret,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
