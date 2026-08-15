import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccountPlanFromStripe } from "@/lib/billing/subscription-status";

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
