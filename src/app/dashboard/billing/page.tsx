"use client";

import { useEffect, useState } from "react";
import { dashboardFetch } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";
import { buttonClass } from "@/components/ui/Button";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support";
import { track } from "@/lib/analytics";

type BillingInfo = {
  plan: string;
  email: string | null;
  stripeConfigured: boolean;
  billingHealth: "ok" | "past_due" | "canceled" | null;
  canChangePlan: boolean;
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
    track("billing_view");
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
    if (error) {
      return (
        <p role="alert" aria-live="assertive" className="text-sm text-red-700">
          {dashboardErrorMessage(error)}
        </p>
      );
    }
    return <p className="text-sm text-zinc-700">Loading billing...</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="dash-title">Billing</h2>
        <p className="dash-lede">
          Quota is shared across every key on this account. Free is 1,000 lookups a month.
          Upgrading agrees to the{" "}
          <a className="underline" href="/legal/terms#paid-subscriptions">
            Terms of Service
          </a>
          , including paid subscriptions (section 16). No refunds for unused lookups. Cancel from
          Manage subscription; the account returns to Free at period end. Billing questions:{" "}
          <a className="underline" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>

      {checkoutStatus === "success" && (
        <p className="dash-alert dash-alert-ok">
          Payment successful. Your plan will update shortly.
        </p>
      )}

      {checkoutStatus === "cancelled" && (
        <p className="dash-alert dash-alert-muted">
          Checkout cancelled. No charge was made. You are still on {info.plan}.
        </p>
      )}

      {(!info.canChangePlan || info.billingHealth === "past_due") && (
        <p className="dash-alert dash-alert-error">
          {info.billingHealth === "past_due"
            ? "Payment failed. Your current plan stays until Stripe finishes retrying. Update the card via Manage subscription."
            : "This subscription cannot be changed here. Update the card or complete payment via Manage subscription."}
        </p>
      )}

      {planChanged && (
        <p className="dash-alert dash-alert-ok">
          Plan updated. Stripe may prorate the difference on the next invoice.
        </p>
      )}

      {error && (
        <p role="alert" aria-live="assertive" className="dash-alert dash-alert-error">
          {dashboardErrorMessage(error)}
        </p>
      )}

      <div className="dash-card">
        <p className="dash-caption">Current plan</p>
        <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold capitalize tracking-tight">
          {info.plan}
        </p>
        {info.email && <p className="mt-1 text-sm text-zinc-600">{info.email}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {(["free", "pro", "scale"] as const).map((planId) => {
          const plan = info.plans[planId];
          const isCurrent = info.plan === planId;
          return (
            <div
              key={planId}
              className={`dash-card ${isCurrent ? "border-zinc-900 bg-zinc-50" : ""}`}
            >
              <p className="font-semibold text-zinc-900">{plan.name}</p>
              <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
                {plan.priceLabel}
              </p>
              <p className="mt-2 text-sm text-zinc-600">
                {plan.monthlyLimit.toLocaleString()} lookups / month
              </p>
              {planId !== "free" && info.stripeConfigured && !isCurrent && info.canChangePlan && (
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
                <p className="mt-4 text-xs font-medium uppercase tracking-wide text-zinc-600">
                  Current
                </p>
              )}
            </div>
          );
        })}
      </div>

      {(info.stripeConfigured && (info.plan !== "free" || !info.canChangePlan)) && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={openPortal}
            disabled={loading !== null}
            className={buttonClass({ variant: "secondary", className: "px-4 py-2" })}
          >
            {loading === "portal" ? "Opening..." : "Manage subscription"}
          </button>
          <p className="text-sm text-zinc-600">
            Change card, download invoices, or cancel from the Stripe portal. Cancel returns the
            account to Free at period end.
          </p>
        </div>
      )}

      {!info.stripeConfigured && (
        <p className="text-sm text-zinc-600">
          Paid upgrades are not enabled on this deploy. The Free quota still applies.
        </p>
      )}
    </div>
  );
}
