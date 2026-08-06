/**
 * PricingSection — homepage pricing block. Pulls plan names/prices/limits
 * from the single source of truth (src/lib/billing/plans.ts) instead of
 * hardcoding numbers here, so this can't drift from what /dashboard/billing
 * and Stripe actually charge.
 */

import Link from "next/link";
import { BILLING_PLANS } from "@/lib/billing/plans";

const PLAN_ORDER = ["free", "pro", "scale"] as const;

const FEATURES: Record<(typeof PLAN_ORDER)[number], string[]> = {
  free: ["REST, MCP, and x402 middleware access", "TypeScript SDK", "Community support"],
  pro: ["Everything in Free", "Score history endpoint", "Priority support"],
  scale: ["Everything in Pro", "Highest rate limit", "Priority support"],
};

export function PricingSection() {
  return (
    <section id="pricing" className="mx-auto max-w-5xl px-5 py-16 md:px-8">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
          Pricing
        </h2>
        <p className="mt-2 text-zinc-600">
          Usage-based. Start free, upgrade when you outgrow the monthly quota.
        </p>
      </div>

      <div className="mt-10 grid gap-6 sm:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const plan = BILLING_PLANS[id];
          const highlighted = id === "pro";

          return (
            <div
              key={id}
              className={`flex flex-col rounded-xl border bg-white p-6 ${
                highlighted ? "border-zinc-900 shadow-sm" : "border-zinc-200"
              }`}
            >
              {highlighted && (
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Most popular
                </p>
              )}
              <p className="font-semibold text-zinc-900">{plan.name}</p>
              <p className="mt-1 text-3xl font-semibold text-zinc-900">{plan.priceLabel}</p>
              <p className="mt-1 text-sm text-zinc-500">
                {plan.monthlyLimit.toLocaleString()} lookups / month
              </p>

              <ul className="mt-5 flex-1 space-y-2 text-sm text-zinc-600">
                {FEATURES[id].map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <svg
                      width={16}
                      height={16}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mt-0.5 shrink-0 text-zinc-400"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {/* 2026-08-06 (320px persona audit A-7): these three CTAs measured
                  36-38px tall, under the 44px minimum touch target — and getting
                  one wrong means landing on the wrong paid plan. min-h-11 (44px)
                  with flex centering fixes the height without changing the
                  visual weight.
                  transition-[background-color] instead of `transition`: the
                  latter animates outline-color in Tailwind v4, fading the focus
                  ring in from white over the dark Pro button. */}
              <Link
                href="/signup"
                className={`mt-6 flex min-h-11 items-center justify-center rounded-md px-4 text-center text-sm font-medium transition-[background-color] ${
                  highlighted
                    ? "bg-zinc-900 text-white hover:bg-zinc-800"
                    : "border border-zinc-300 text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                {id === "free" ? "Get API key" : `Start with ${plan.name}`}
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
