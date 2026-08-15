"use client";

import { useEffect, useState } from "react";
import { dashboardFetch } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";
import { buttonClass } from "@/components/ui/Button";

type BillingInfo = {
  plan: string;
  email: string | null;
  stripeConfigured: boolean;
  plans: Record<string, { name: string; monthlyLimit: number; priceLabel: string }>;
};

export default function DashboardBillingPage() {
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [checkoutStatus] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("checkout");
  });
  const [planChanged, setPlanChanged] = useState(false);

  useEffect(() => {
    dashboardFetch<BillingInfo>("/api/billing/checkout")
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : "load_failed"));
  }, []);

  async function upgrade(plan: "pro" | "scale") {
    setLoading(plan);
    setError(null);
    setPlanChanged(false);
    try {
      const data = await dashboardFetch<{ url?: string; updated?: boolean }>(
        "/api/billing/checkout",
        {
          method: "POST",
          body: JSON.stringify({ plan }),
        },
      );

      if (data.url) {
        // No existing subscription — Stripe Checkout will collect payment.
        globalThis.location.assign(data.url);
        return;
      }

      // Existing subscription was changed in place (no redirect needed).
      setPlanChanged(true);
      setLoading(null);
      dashboardFetch<BillingInfo>("/api/billing/checkout").then(setInfo).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "checkout_failed");
      setLoading(null);
    }
  }

  async function openPortal() {
    setLoading("portal");
    setError(null);
    try {
      const data = await dashboardFetch<{ url: string }>(
        "/api/billing/checkout?action=portal",
      );
      globalThis.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "portal_failed");
      setLoading(null);
    }
  }

  if (!info) {
    return <p className="text-sm text-brand">Loading billing...</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="dash-title">Billing</h2>
        <p className="mt-1 text-sm text-brand">
          Manage your plan. Quota is shared across all API keys on your account.
        </p>
      </div>

      {checkoutStatus === "success" && (
        <p className="rounded-[2px] border border-brand-deep bg-paper px-3 py-2 text-sm text-brand-deep">
          Payment successful. Your plan will update shortly.
        </p>
      )}

      {planChanged && (
        <p className="rounded-[2px] border border-brand-deep bg-paper px-3 py-2 text-sm text-brand-deep">
          Plan updated. Your subscription was changed without creating a new charge.
        </p>
      )}

      {error && <p className="text-sm text-block-ink">{dashboardErrorMessage(error)}</p>}

      <div>
        <dt className="doc-caption">Current plan</dt>
        <dd className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold capitalize text-brand-deep">
          {info.plan}
        </dd>
        {info.email && <dd className="mt-1 text-sm text-brand">{info.email}</dd>}
      </div>

      <div className="table-scroll">
        <table className="fact-table fact-table-fixed">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Price</th>
              <th>Lookups / month</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(["free", "pro", "scale"] as const).map((planId) => {
              const plan = info.plans[planId];
              const isCurrent = info.plan === planId;
              return (
                <tr key={planId}>
                  <td>{plan.name}</td>
                  <td className="num">{plan.priceLabel}</td>
                  <td className="num">{plan.monthlyLimit.toLocaleString()}</td>
                  <td className="text-right">
                    {isCurrent ? (
                      <span className="marker marker-live">Current</span>
                    ) : planId !== "free" && info.stripeConfigured ? (
                      <button
                        type="button"
                        disabled={loading !== null}
                        onClick={() => upgrade(planId)}
                        className={buttonClass({ size: "sm" })}
                      >
                        {loading === planId ? "Redirecting..." : `Upgrade`}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {info.stripeConfigured && info.plan !== "free" && (
        <button
          type="button"
          onClick={openPortal}
          disabled={loading !== null}
          className={buttonClass({ variant: "secondary" })}
        >
          {loading === "portal" ? "Opening..." : "Manage subscription"}
        </button>
      )}

      {!info.stripeConfigured && (
        <p className="text-sm text-brand-lift">
          Stripe is not configured in this environment. Set STRIPE_SECRET_KEY and price IDs for
          paid upgrades.
        </p>
      )}
    </div>
  );
}
