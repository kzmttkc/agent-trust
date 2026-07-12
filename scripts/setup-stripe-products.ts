/**
 * Create Vouch Pro / Scale Stripe products and monthly prices.
 * Usage: STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/setup-stripe-products.ts
 *
 * Prints price IDs to set as STRIPE_PRICE_PRO and STRIPE_PRICE_SCALE in Vercel.
 */
import Stripe from "stripe";

const PRO_AMOUNT = 4900;
const SCALE_AMOUNT = 19900;

async function findOrCreateProduct(
  stripe: Stripe,
  name: string,
  metadata: Record<string, string>,
): Promise<Stripe.Product> {
  const existing = await stripe.products.search({
    query: `name:'${name}' AND active:'true'`,
    limit: 1,
  });

  if (existing.data[0]) return existing.data[0];

  return stripe.products.create({ name, metadata });
}

async function findOrCreatePrice(
  stripe: Stripe,
  productId: string,
  unitAmount: number,
  lookupKey: string,
): Promise<Stripe.Price> {
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 20,
  });

  const match = prices.data.find(
    (price) =>
      price.lookup_key === lookupKey ||
      (price.unit_amount === unitAmount && price.recurring?.interval === "month"),
  );
  if (match) return match;

  return stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: unitAmount,
    recurring: { interval: "month" },
    lookup_key: lookupKey,
  });
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is required");
  }

  const stripe = new Stripe(key);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const proProduct = await findOrCreateProduct(stripe, "Vouch Pro", { plan: "pro" });
  const scaleProduct = await findOrCreateProduct(stripe, "Vouch Scale", { plan: "scale" });

  const proPrice = await findOrCreatePrice(stripe, proProduct.id, PRO_AMOUNT, "vouch_pro_monthly");
  const scalePrice = await findOrCreatePrice(
    stripe,
    scaleProduct.id,
    SCALE_AMOUNT,
    "vouch_scale_monthly",
  );

  console.log(JSON.stringify({
    ok: true,
    appUrl,
    STRIPE_PRICE_PRO: proPrice.id,
    STRIPE_PRICE_SCALE: scalePrice.id,
    webhookPath: "/api/billing/webhook",
    webhookEvents: [
      "checkout.session.completed",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
