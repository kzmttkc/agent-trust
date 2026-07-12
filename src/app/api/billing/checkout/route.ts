import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createBillingPortalSession,
  createCheckoutSession,
} from "@/lib/billing/stripe";
import { BILLING_PLANS, isStripeConfigured, type PaidPlan } from "@/lib/billing/plans";
import { getAccountById, setAccountStripeIds } from "@/lib/db/accounts";
import { ensureOwnerUserId } from "@/lib/db/api-keys";
import { authorizeDashboardRequest } from "@/lib/dashboard/auth";

const checkoutSchema = z.object({
  plan: z.enum(["pro", "scale"]),
});

export async function POST(request: NextRequest) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const userId = await ensureOwnerUserId(auth.ctx.apiKeyId);
  const account = await getAccountById(userId);
  if (!account) {
    return NextResponse.json({ error: "account_not_found" }, { status: 404 });
  }

  if (account.plan === parsed.data.plan) {
    return NextResponse.json({ error: "already_on_plan" }, { status: 400 });
  }

  try {
    const { url, customerId } = await createCheckoutSession({
      accountId: account.id,
      email: account.email,
      plan: parsed.data.plan as PaidPlan,
      customerId: account.stripeCustomerId,
    });

    if (!account.stripeCustomerId) {
      await setAccountStripeIds(account.id, { stripeCustomerId: customerId });
    }

    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "checkout_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  const userId = await ensureOwnerUserId(auth.ctx.apiKeyId);
  const account = await getAccountById(userId);

  const action = request.nextUrl.searchParams.get("action");

  if (action === "portal") {
    if (!isStripeConfigured() || !account?.stripeCustomerId) {
      return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
    }

    try {
      const url = await createBillingPortalSession(account.stripeCustomerId);
      return NextResponse.json({ url });
    } catch {
      return NextResponse.json({ error: "portal_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({
    plan: account?.plan ?? auth.ctx.plan,
    email: account?.email ?? null,
    stripeConfigured: isStripeConfigured(),
    plans: BILLING_PLANS,
  });
}
