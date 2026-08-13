/**
 * PricingSection — Appendix A of the memo.
 *
 * Plan names, prices and limits come from the single source of truth
 * (src/lib/billing/plans.ts) instead of being hardcoded here, so this cannot
 * drift from what /dashboard/billing and Stripe actually charge.
 *
 * 2026-08-13 vet402: three price cards became one fact table. Cards of equal
 * weight are the category default and say nothing; a table lets the three
 * quotas be read against each other in one glance, with the digits in a
 * tabular column. The section keeps its `#pricing` id — the header nav and
 * external links point at it.
 */

import TrackedLink from "@/components/site/TrackedLink";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { buttonClass } from "@/components/ui/Button";

const PLAN_ORDER = ["free", "pro", "scale"] as const;

const INCLUDES: Record<(typeof PLAN_ORDER)[number], string> = {
  free: "REST, MCP and x402 middleware, TypeScript SDK",
  pro: "Everything in Free, plus score history and priority support",
  scale: "Everything in Pro, at the highest rate limit",
};

export function PricingSection() {
  return (
    <section id="pricing" className="scroll-mt-24">
      <h2 className="sec-head">
        <span className="sec-no">A.</span>
        <span>Access tiers</span>
      </h2>
      <p className="doc-p">
        Usage-based. The free tier is enough to wire a check into an x402 flow and see real results
        before committing to anything.
      </p>

      <div className="table-scroll">
        <table className="fact-table">
          <caption className="sr-only">vet402 access tiers, monthly quota and what each includes</caption>
          <thead>
            <tr>
              <th scope="col">Tier</th>
              <th scope="col" className="num">
                Price
              </th>
              <th scope="col" className="num">
                Lookups / month
              </th>
              <th scope="col">Includes</th>
            </tr>
          </thead>
          <tbody>
            {PLAN_ORDER.map((id) => {
              const plan = BILLING_PLANS[id];
              return (
                <tr key={id}>
                  <td>{plan.name}</td>
                  <td className="num whitespace-nowrap text-brand-deep">{plan.priceLabel}</td>
                  <td className="num whitespace-nowrap text-brand-deep">
                    {plan.monthlyLimit.toLocaleString("en-US")}
                  </td>
                  <td>{INCLUDES[id]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 2026-08-06 growth: pricing_cta_click{plan} — which plan people click is
          the only pre-signup price-sensitivity signal we have (all CTAs land on
          the same /signup URL, so the pageview alone can't tell them apart).
          2026-08-13: the three per-card buttons became one, because the table
          above already carries the comparison the cards were making — and the
          two paid buttons pointed at /signup anyway. The upgrade path is named
          in prose instead of being a second button that lands an anonymous
          visitor on a page that needs a session. */}
      <div className="mt-7">
        <TrackedLink
          href="/signup"
          event="pricing_cta_click"
          props={{ plan: "free" }}
          className={buttonClass({ size: "md" })}
        >
          Get a free API key
        </TrackedLink>
        <p className="doc-note mt-4">
          Paid tiers are upgraded from the dashboard once a key exists. No card is required to
          start.
        </p>
      </div>
    </section>
  );
}
