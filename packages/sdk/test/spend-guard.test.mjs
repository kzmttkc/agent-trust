// Unit tests for the SpendGuard decision logic (node:test, no framework
// dependency — run with `npm test` after `npm run build`).
import assert from "node:assert/strict";
import { test } from "node:test";
import { SpendGuard } from "../dist/index.js";

const PAYEE = "0x1111111111111111111111111111111111111111";

function payeeScore(overrides = {}) {
  return {
    payee: PAYEE,
    score: 80,
    recommendation: "ALLOW",
    dataDepth: "moderate",
    signals: {
      receiving: { paymentCount: 5, uniqueDays: 3, distinctPayers: 2, score: 68 },
      walletHealth: { ageDays: 120, txCount: 300, isBurner: false, score: 85 },
      drainPattern: {
        detected: false,
        drainRatio: 0.1,
        outgoingCount: 3,
        incomingCount: 8,
        score: 85,
      },
      outcomeHistory: { types: [], adjustment: 0 },
      flags: [],
    },
    scoredAt: new Date().toISOString(),
    cacheExpiresAt: new Date(Date.now() + 300000).toISOString(),
    disclaimer: "test",
    ...overrides,
  };
}

const scoreFetcher = (overrides) => async () => payeeScore(overrides);
const failingFetcher = async () => {
  throw new Error("scoring_unavailable");
};
const mustNotFetch = async () => {
  throw new Error("unexpected_trust_lookup");
};

test("allows a payment within all limits", async () => {
  const guard = new SpendGuard(
    { maxPerTxUsd: 10, dailyBudgetUsd: 50, minPayeeScore: 40 },
    scoreFetcher(),
  );
  const decision = await guard.evaluate({ payee: PAYEE, amountUsd: 5 });
  assert.equal(decision.allow, true);
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.spentTodayUsd, 5);
  assert.equal(decision.remainingDailyBudgetUsd, 45);
  assert.equal(decision.payeeScore.score, 80);
});

test("denies above the per-tx cap without burning a trust lookup", async () => {
  const guard = new SpendGuard(
    { maxPerTxUsd: 10, minPayeeScore: 40 },
    mustNotFetch,
  );
  const decision = await guard.evaluate({ payee: PAYEE, amountUsd: 11 });
  assert.equal(decision.allow, false);
  assert.deepEqual(decision.reasons, ["max_per_tx_exceeded"]);
  assert.equal(decision.payeeScore, null);
  assert.equal(decision.spentTodayUsd, 0); // denied payments reserve nothing
});

test("denies once the daily budget would be exceeded, then releases", async () => {
  const guard = new SpendGuard({ dailyBudgetUsd: 10 }, mustNotFetch);

  const first = await guard.evaluate({ payee: PAYEE, amountUsd: 6 });
  assert.equal(first.allow, true);

  const second = await guard.evaluate({ payee: PAYEE, amountUsd: 6 });
  assert.equal(second.allow, false);
  assert.deepEqual(second.reasons, ["daily_budget_exceeded"]);
  assert.equal(second.remainingDailyBudgetUsd, 4);

  guard.release(6); // first payment did not execute
  const third = await guard.evaluate({ payee: PAYEE, amountUsd: 6 });
  assert.equal(third.allow, true);
});

test("exact budget consumption is allowed (boundary)", async () => {
  const guard = new SpendGuard({ dailyBudgetUsd: 10 }, mustNotFetch);
  const decision = await guard.evaluate({ payee: PAYEE, amountUsd: 10 });
  assert.equal(decision.allow, true);
  assert.equal(decision.remainingDailyBudgetUsd, 0);
});

test("denies on payee score below minPayeeScore", async () => {
  const guard = new SpendGuard({ minPayeeScore: 40 }, scoreFetcher({ score: 25 }));
  const decision = await guard.evaluate({ payee: PAYEE, amountUsd: 1 });
  assert.equal(decision.allow, false);
  assert.deepEqual(decision.reasons, ["payee_score_below_min"]);
  assert.equal(decision.payeeScore.score, 25);
});

test("denies on BLOCK recommendation when blockOnRecommendation is set", async () => {
  const guard = new SpendGuard(
    { blockOnRecommendation: true },
    scoreFetcher({ score: 70, recommendation: "BLOCK" }),
  );
  const decision = await guard.evaluate({ payee: PAYEE, amountUsd: 1 });
  assert.equal(decision.allow, false);
  assert.deepEqual(decision.reasons, ["payee_recommendation_block"]);
});

test("ignores BLOCK recommendation when blockOnRecommendation is not set", async () => {
  const guard = new SpendGuard(
    { minPayeeScore: 40 },
    scoreFetcher({ score: 70, recommendation: "BLOCK" }),
  );
  const decision = await guard.evaluate({ payee: PAYEE, amountUsd: 1 });
  assert.equal(decision.allow, true);
});

test("fails closed when the trust lookup errors", async () => {
  const guard = new SpendGuard({ minPayeeScore: 40 }, failingFetcher);
  const decision = await guard.evaluate({ payee: PAYEE, amountUsd: 1 });
  assert.equal(decision.allow, false);
  assert.deepEqual(decision.reasons, ["payee_trust_unavailable"]);
});

test("skips the trust lookup entirely for a purely local policy", async () => {
  const guard = new SpendGuard({ maxPerTxUsd: 10 }, mustNotFetch);
  const decision = await guard.evaluate({ payee: PAYEE, amountUsd: 5 });
  assert.equal(decision.allow, true);
  assert.equal(decision.payeeScore, null);
});

test("resets the budget counter when the UTC day rolls over", async () => {
  let now = new Date("2026-07-15T23:50:00Z");
  const guard = new SpendGuard({ dailyBudgetUsd: 10 }, mustNotFetch, () => now);

  const first = await guard.evaluate({ payee: PAYEE, amountUsd: 8 });
  assert.equal(first.allow, true);

  const sameDay = await guard.evaluate({ payee: PAYEE, amountUsd: 8 });
  assert.equal(sameDay.allow, false);

  now = new Date("2026-07-16T00:10:00Z");
  const nextDay = await guard.evaluate({ payee: PAYEE, amountUsd: 8 });
  assert.equal(nextDay.allow, true);
  assert.equal(guard.state().day, "2026-07-16");
  assert.equal(guard.state().spentTodayUsd, 8);
});

test("collects multiple deny reasons from local rules", async () => {
  const guard = new SpendGuard(
    { maxPerTxUsd: 5, dailyBudgetUsd: 8 },
    mustNotFetch,
  );
  const decision = await guard.evaluate({ payee: PAYEE, amountUsd: 9 });
  assert.equal(decision.allow, false);
  assert.deepEqual(decision.reasons, ["max_per_tx_exceeded", "daily_budget_exceeded"]);
});

test("rejects invalid inputs and policies", async () => {
  const guard = new SpendGuard({}, mustNotFetch);
  await assert.rejects(() => guard.evaluate({ payee: "not-an-address", amountUsd: 1 }), {
    message: "invalid_payee_address",
  });
  await assert.rejects(() => guard.evaluate({ payee: PAYEE, amountUsd: 0 }), {
    message: "invalid_amount_usd",
  });
  await assert.rejects(() => guard.evaluate({ payee: PAYEE, amountUsd: NaN }), {
    message: "invalid_amount_usd",
  });
  assert.throws(() => new SpendGuard({ maxPerTxUsd: -1 }, mustNotFetch), {
    message: "invalid_policy_maxPerTxUsd",
  });
  assert.throws(() => new SpendGuard({ minPayeeScore: 101 }, mustNotFetch), {
    message: "invalid_policy_minPayeeScore",
  });
});

test("concurrent evaluates cannot jointly overshoot the daily budget (TOCTOU)", async () => {
  // Both trust lookups are held in flight simultaneously; without the
  // optimistic reservation, both calls would read spentTodayUsd=0 while
  // awaiting and both would slip past the $10 budget.
  let releaseLookups;
  const gate = new Promise((resolve) => {
    releaseLookups = resolve;
  });
  const guard = new SpendGuard({ dailyBudgetUsd: 10, minPayeeScore: 40 }, async () => {
    await gate;
    return payeeScore();
  });

  const inFlight = Promise.all([
    guard.evaluate({ payee: PAYEE, amountUsd: 6 }),
    guard.evaluate({ payee: PAYEE, amountUsd: 6 }),
  ]);
  releaseLookups();
  const [first, second] = await inFlight;

  const allowed = [first, second].filter((d) => d.allow);
  const denied = [first, second].filter((d) => !d.allow);
  assert.equal(allowed.length, 1);
  assert.equal(denied.length, 1);
  assert.deepEqual(denied[0].reasons, ["daily_budget_exceeded"]);
  assert.equal(guard.state().spentTodayUsd, 6);
});

test("trust-rule deny returns the optimistic reservation", async () => {
  const guard = new SpendGuard(
    { dailyBudgetUsd: 10, minPayeeScore: 40 },
    scoreFetcher({ score: 25 }),
  );
  const denied = await guard.evaluate({ payee: PAYEE, amountUsd: 6 });
  assert.equal(denied.allow, false);
  assert.deepEqual(denied.reasons, ["payee_score_below_min"]);
  assert.equal(guard.state().spentTodayUsd, 0); // reservation given back

  // The full budget is still available for a trustworthy payee afterwards.
  const guard2 = new SpendGuard(
    { dailyBudgetUsd: 10, minPayeeScore: 40 },
    scoreFetcher(),
  );
  const first = await guard2.evaluate({ payee: PAYEE, amountUsd: 6 });
  const second = await guard2.evaluate({ payee: PAYEE, amountUsd: 4 });
  assert.equal(first.allow, true);
  assert.equal(second.allow, true);
});

test("release clamps at zero and never goes negative", async () => {
  const guard = new SpendGuard({ dailyBudgetUsd: 10 }, mustNotFetch);
  await guard.evaluate({ payee: PAYEE, amountUsd: 3 });
  guard.release(100);
  assert.equal(guard.state().spentTodayUsd, 0);
});
