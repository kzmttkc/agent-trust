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
    return <p className="text-sm text-zinc-600">Loading billing...</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Billing</h2>
        <p className="text-sm text-zinc-600">
          Manage your plan. Quota is shared across all API keys on your account.
        </p>
      </div>

      {checkoutStatus === "success" && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Payment successful. Your plan will update shortly.
        </p>
      )}

      {planChanged && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Plan updated. Your subscription was changed without creating a new charge.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{dashboardErrorMessage(error)}</p>}

      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <p className="text-sm text-zinc-500">Current plan</p>
        <p className="mt-1 text-2xl font-semibold capitalize">{info.plan}</p>
        {info.email && <p className="mt-1 text-sm text-zinc-600">{info.email}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {(["free", "pro", "scale"] as const).map((planId) => {
          const plan = info.plans[planId];
          const isCurrent = info.plan === planId;
          return (
            <div
              key={planId}
              className={`rounded-xl border p-5 ${isCurrent ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white"}`}
            >
              <p className="font-semibold">{plan.name}</p>
              <p className="mt-1 text-2xl">{plan.priceLabel}</p>
              <p className="mt-2 text-sm text-zinc-600">
                {plan.monthlyLimit.toLocaleString()} lookups / month
              </p>
              {planId !== "free" && info.stripeConfigured && !isCurrent && (
                <button
                  type="button"
                  disabled={loading !== null}
                  onClick={() => upgrade(planId)}
                  className={buttonClass({ className: "mt-4 w-full" })}
                >
                  {loading === planId ? "Redirecting..." : `Upgrade to ${plan.name}`}
                </button>
              )}
              {isCurrent && (
                <p className="mt-4 text-xs font-medium uppercase text-zinc-500">Current</p>
              )}
            </div>
          );
        })}
      </div>

      {info.stripeConfigured && info.plan !== "free" && (
        <button
          type="button"
          onClick={openPortal}
          disabled={loading !== null}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
        >
          {loading === "portal" ? "Opening..." : "Manage subscription"}
        </button>
      )}

      {!info.stripeConfigured && (
        <p className="text-sm text-zinc-500">
          Stripe is not configured in this environment. Set STRIPE_SECRET_KEY and price IDs for
          paid upgrades.
        </p>
      )}
    </div>
  );
}
