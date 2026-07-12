export const BILLING_PLANS = {
  free: {
    name: "Free",
    monthlyLimit: 1_000,
    priceLabel: "$0",
    stripePriceId: null,
  },
  pro: {
    name: "Pro",
    monthlyLimit: 50_000,
    priceLabel: "$49/mo",
    stripePriceId: () => process.env.STRIPE_PRICE_PRO ?? null,
  },
  scale: {
    name: "Scale",
    monthlyLimit: 500_000,
    priceLabel: "$199/mo",
    stripePriceId: () => process.env.STRIPE_PRICE_SCALE ?? null,
  },
} as const;

export type PaidPlan = "pro" | "scale";

export function planFromStripePriceId(priceId: string): PaidPlan | null {
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_SCALE) return "scale";
  return null;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
