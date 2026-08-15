import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkoutDisposition,
  resolveAccountPlanFromStripe,
} from "@/lib/billing/subscription-status";

test("active and trialing keep the paid plan and are healthy", () => {
  assert.deepEqual(resolveAccountPlanFromStripe({ stripeStatus: "active", pricePlan: "pro" }), {
    plan: "pro",
    health: "ok",
  });
  assert.deepEqual(
    resolveAccountPlanFromStripe({ stripeStatus: "trialing", pricePlan: "scale" }),
    { plan: "scale", health: "ok" },
  );
});

test("past_due keeps the paid plan so dunning does not silently drop quota", () => {
  assert.deepEqual(
    resolveAccountPlanFromStripe({ stripeStatus: "past_due", pricePlan: "pro" }),
    { plan: "pro", health: "past_due" },
  );
});

test("canceled and unpaid drop to free", () => {
  assert.deepEqual(
    resolveAccountPlanFromStripe({ stripeStatus: "canceled", pricePlan: "pro" }),
    { plan: "free", health: "canceled" },
  );
  assert.deepEqual(
    resolveAccountPlanFromStripe({ stripeStatus: "unpaid", pricePlan: "scale" }),
    { plan: "free", health: "canceled" },
  );
});

test("missing price on a healthy subscription is free, not a guessed paid tier", () => {
  assert.deepEqual(resolveAccountPlanFromStripe({ stripeStatus: "active", pricePlan: null }), {
    plan: "free",
    health: "ok",
  });
});

test("active and trialing subscriptions change plan in place", () => {
  assert.equal(checkoutDisposition("active"), "change_in_place");
  assert.equal(checkoutDisposition("trialing"), "change_in_place");
});

test("canceled subscriptions may start a fresh Checkout", () => {
  assert.equal(checkoutDisposition("canceled"), "new_checkout");
  assert.equal(checkoutDisposition("incomplete_expired"), "new_checkout");
  assert.equal(checkoutDisposition(null), "new_checkout");
});

test("past_due unpaid incomplete and paused must use the portal — never a second Checkout", () => {
  assert.equal(checkoutDisposition("past_due"), "use_portal");
  assert.equal(checkoutDisposition("unpaid"), "use_portal");
  assert.equal(checkoutDisposition("incomplete"), "use_portal");
  assert.equal(checkoutDisposition("paused"), "use_portal");
});

test("checkout POST refuses a second session when Stripe says the old one is still living", () => {
  const route = readFileSync(join(process.cwd(), "src/app/api/billing/checkout/route.ts"), "utf8");
  assert.match(route, /checkoutDisposition/);
  assert.match(route, /update_payment_method/);
  assert.match(
    route,
    /!== "new_checkout"/,
    "an active subscription missing line items must not fall through to createCheckoutSession",
  );
  assert.match(route, /canChangePlan = false/);
});

test("billing UI hides Upgrade while payment is past_due and still offers the portal", () => {
  const page = readFileSync(join(process.cwd(), "src/app/dashboard/billing/page.tsx"), "utf8");
  assert.match(page, /canChangePlan/);
  assert.match(page, /!info\.canChangePlan/);
});

test("Stripe webhook verifies the signature without constructing a Stripe client", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/billing/webhook/route.ts"), "utf8");
  const constructIdx = src.indexOf("Stripe.webhooks.constructEvent");
  const getStripeCall = src.indexOf("getStripe()");
  assert.ok(constructIdx >= 0, "signature check must use Stripe.webhooks.constructEvent");
  assert.ok(getStripeCall > constructIdx, "getStripe() must not run before signature verification");
  assert.match(src, /subscription_details/);
});
