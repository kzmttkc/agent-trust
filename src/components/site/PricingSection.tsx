/**
 * PricingSection — homepage pricing block. Pulls plan names/prices/limits
 * from the single source of truth (src/lib/billing/plans.ts) instead of
 * hardcoding numbers here, so this can't drift from what /dashboard/billing
 * and Stripe actually charge.
 */

import TrackedLink from "@/components/site/TrackedLink";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { buttonClass } from "@/components/ui/Button";

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
                    {/* 2026-08-12: チェックは「その機能が含まれる」という意味を担う
                        グラフィックなので WCAG 1.4.11 の 3:1 が要る。zinc-400 は白
                        カード上 2.62:1 だった → zinc-500 (白地 4.83:1)。 */}
                    <svg
                      width={16}
                      height={16}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mt-0.5 shrink-0 text-zinc-500"
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
              {/* 2026-08-06 growth: pricing_cta_click{plan} — which plan card
                  people click is the only pre-signup price-sensitivity signal
                  we have (all three CTAs land on the same /signup URL, so the
                  pageview alone can't tell them apart). */}
              {/* 2026-08-12 FIX-9: font-size / weight は 08-11 に2段へ揃ったが、
                  高さだけ ヒーロー48 / ここ44 / ナビ36 の3値が残っていた。
                  ここは唯一 buttonClass() を通していない主CTAで、値が独自に
                  書かれていたのが原因。size:"md" でヒーローと同格の48pxになり、
                  44px の当たり判定（2026-08-06 の 320px 監査 A-7）も維持される。 */}
              <TrackedLink
                href="/signup"
                event="pricing_cta_click"
                props={{ plan: id }}
                className={buttonClass({
                  variant: highlighted ? "primary" : "secondary",
                  size: "md",
                  className: "mt-6 w-full text-center",
                })}
              >
                {id === "free" ? "Get API key" : `Start with ${plan.name}`}
              </TrackedLink>
            </div>
          );
        })}
      </div>
    </section>
  );
}
