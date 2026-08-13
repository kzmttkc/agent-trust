// ============================================================
// Vouch — scoring helpers. The number itself.
//
// Every published claim about what a Vouch score means reduces to these
// functions: the weights (vet402 2026-08-13 — identity .05 / reputation .10 /
// wallet .25 / x402 .40, divided by 0.8 because `manual` is a policy layer and
// not a signal; forgery cost and weight now correlate), the bootstrap neutral
// of 50 for agents with no x402 history, the burner penalty, and the rule that
// a customer whitelist is a floor rather than a bypass.
//
// Two of these have a specific way of going wrong that no type checker sees:
//   - weightSum. `manual: 0.2` sits in the same constant object as the four
//     signal weights. Summing the object instead of the four named weights
//     divides by 1.0, quietly deflating every score by 20% — every ALLOW near
//     the threshold becomes a WARN and no error is raised anywhere.
//   - the whitelist floor. applyManualList must NOT lift a score when sybil
//     risk is anything but low, or a customer's own allowlist becomes a way to
//     launder a suspicious agent past the gate.
//
// Run: npm test
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyManualList,
  applySybilPenalty,
  buildScoreBreakdown,
  computeWeightedScore,
  dampenReputationForSybil,
  normalizeWalletScore,
  scoreIdentity,
  scoreReputation,
  scoreX402Payments,
  walletsMatch,
} from "@/lib/scoring/helpers";
import { SCORE_WEIGHTS } from "@/lib/chain/config";
import type { Address } from "viem";

// ---- identity --------------------------------------------------------------

test("identity: unregistered is 0, registered is 60, with metadata is 100", () => {
  assert.equal(scoreIdentity(false, false), 0);
  assert.equal(scoreIdentity(false, true), 0, "metadata cannot rescue an unregistered agent");
  assert.equal(scoreIdentity(true, false), 60);
  assert.equal(scoreIdentity(true, true), 100);
});

// ---- reputation ------------------------------------------------------------

test("reputation: no feedback is a neutral 30, not a zero", () => {
  assert.equal(scoreReputation(0, 0, 18), 30);
  assert.equal(scoreReputation(0, 99_000, 3), 30, "count is what decides the bootstrap case");
});

test("reputation: avg*0.8 + min(20, count*2), clamped to 0..100", () => {
  // avg 100 (raw 100 * 10^0), 1 review → 100*0.8 + 2 = 82
  assert.equal(scoreReputation(1, 100, 0), 82);
  // avg 50, 5 reviews → 40 + 10 = 50
  assert.equal(scoreReputation(5, 50, 0), 50);
  // volume boost caps at 20 no matter how many reviews
  assert.equal(scoreReputation(1_000, 100, 0), 100);
  assert.equal(scoreReputation(10, 100, 0), 100);
});

test("reputation: decimals are applied to the on-chain summary value", () => {
  // 80 with 2 decimals = 0.80 average → 0.8*0.8 + 2 = 2.64 → 3
  assert.equal(scoreReputation(1, 80, 2), 3);
  // 8000 with 2 decimals = 80 average → 64 + 2 = 66
  assert.equal(scoreReputation(1, 8_000, 2), 66);
});

test("reputation: an out-of-range average cannot push the score past 100", () => {
  // The clamp is on the AVERAGE (min 100), not on the final score: an absurd
  // on-chain summary value cannot buy more than the 80 points the average is
  // worth, so the volume boost still decides the rest.
  assert.equal(scoreReputation(1, 10_000, 0), 82);
  assert.equal(scoreReputation(1, -500, 0), 2, "a negative average floors at 0, keeping the volume boost");
});

test("reputation is dampened to 35 when the sybil signals are unreliable", () => {
  for (const flag of [
    "review_velocity_anomaly",
    "feedback_stats_unavailable",
    "reputation_summary_unavailable",
  ]) {
    assert.equal(dampenReputationForSybil(90, [flag]), 35, flag);
  }
  assert.equal(dampenReputationForSybil(20, ["review_velocity_anomaly"]), 20, "never raises a score");
  assert.equal(dampenReputationForSybil(90, ["new_burner_wallet"]), 90, "unrelated flags do not dampen");
  assert.equal(dampenReputationForSybil(90, []), 90);
});

// ---- wallet ----------------------------------------------------------------

test("wallet: base 50, plus age, plus activity", () => {
  assert.equal(normalizeWalletScore({ ageDays: 0, txCount: 0 }).score, 20, "burner: 50 - 30");
  assert.equal(normalizeWalletScore({ ageDays: 90, txCount: 100 }).score, 95);
  assert.equal(normalizeWalletScore({ ageDays: 30, txCount: 20 }).score, 75);
  assert.equal(normalizeWalletScore({ ageDays: 7, txCount: 5 }).score, 60);
  assert.equal(normalizeWalletScore({ ageDays: 6, txCount: 5 }).score, 55, "5 tx is not a burner");
});

test("wallet: the burner rule needs BOTH young and inactive", () => {
  const burner = normalizeWalletScore({ ageDays: 6, txCount: 4 });
  assert.equal(burner.isBurner, true);
  assert.deepEqual(burner.flags, ["new_burner_wallet"]);
  assert.equal(burner.score, 20, "50 + 0 age + 0 tx - 30 burner");

  assert.equal(normalizeWalletScore({ ageDays: 7, txCount: 4 }).isBurner, false);
  assert.equal(normalizeWalletScore({ ageDays: 6, txCount: 5 }).isBurner, false);
  assert.deepEqual(normalizeWalletScore({ ageDays: 400, txCount: 9_999 }).flags, []);
});

test("wallet: the score is clamped and rounded", () => {
  const s = normalizeWalletScore({ ageDays: 10_000, txCount: 10_000 }).score;
  assert.ok(s <= 100 && Number.isInteger(s), `got ${s}`);
});

// ---- x402 ------------------------------------------------------------------

test("x402: no settlement history is a neutral 50, never a penalty", () => {
  assert.equal(scoreX402Payments({ paymentCount: 0, uniqueDays: 0 }), 50);
  assert.equal(scoreX402Payments({ paymentCount: -1, uniqueDays: 5 }), 50);
});

test("x402: any real history beats no history", () => {
  assert.ok(scoreX402Payments({ paymentCount: 1, uniqueDays: 1 }) > 50);
  assert.equal(scoreX402Payments({ paymentCount: 1, uniqueDays: 1 }), 59); // 55+4, one day earns no spread bonus
  assert.equal(scoreX402Payments({ paymentCount: 20, uniqueDays: 14 }), 95); // 55+30+10
  assert.equal(scoreX402Payments({ paymentCount: 10, uniqueDays: 7 }), 83); // 55+22+6
  assert.equal(scoreX402Payments({ paymentCount: 5, uniqueDays: 3 }), 73); // 55+15+3
  assert.equal(scoreX402Payments({ paymentCount: 2, uniqueDays: 0 }), 63); // 55+8
});

test("x402: the score rises monotonically with payment count", () => {
  let prev = -1;
  for (const n of [1, 2, 5, 10, 20, 100]) {
    const s = scoreX402Payments({ paymentCount: n, uniqueDays: 0 });
    assert.ok(s >= prev, `count ${n} scored ${s} after ${prev}`);
    prev = s;
  }
});

// ---- the weighted sum ------------------------------------------------------

test("weights: manual is a policy layer and is NOT in the divisor", () => {
  const signalSum =
    SCORE_WEIGHTS.identity + SCORE_WEIGHTS.reputation + SCORE_WEIGHTS.wallet + SCORE_WEIGHTS.x402;
  assert.equal(Math.round(signalSum * 100) / 100, 0.8, "the four signal weights sum to 0.8");
  assert.equal(SCORE_WEIGHTS.manual, 0.2);
  // If the divisor ever became 1.0, this all-100 case would come out as 80.
  assert.equal(computeWeightedScore(100, 100, 100, 100), 100);
});

test("weights: each signal moves the score by its own share", () => {
  // vet402 2026-08-13: forgery cost and weight now correlate. The self-attested
  // signals (identity, reputation) carry the LEAST, the chain-confirmed
  // settlement (x402) the MOST. Shares are score×weight÷0.8.
  assert.equal(computeWeightedScore(0, 0, 0, 0), 0);
  // identity .05/.8 = 6.25% → rounds to 6
  assert.equal(computeWeightedScore(100, 0, 0, 0), 6);
  // reputation .10/.8 = 12.5% → rounds to 13
  assert.equal(computeWeightedScore(0, 100, 0, 0), 13);
  // wallet .25/.8 = 31.25% → rounds to 31
  assert.equal(computeWeightedScore(0, 0, 100, 0), 31);
  // x402 .40/.8 = 50% — the hardest-to-fake signal moves the score the most
  assert.equal(computeWeightedScore(0, 0, 0, 100), 50);
});

test("weights: x402 defaults to the bootstrap neutral when omitted", () => {
  assert.equal(computeWeightedScore(0, 0, 0), computeWeightedScore(0, 0, 0, 50));
});

// ---- sybil penalties -------------------------------------------------------

test("each sybil flag subtracts its documented amount", () => {
  const cases: [string, number][] = [
    ["review_velocity_anomaly", 15],
    ["feedback_stats_unavailable", 15],
    ["reputation_summary_unavailable", 20],
    ["owner_count_unavailable", 25],
    ["wallet_metrics_unavailable", 20],
    ["funding_cluster", 20],
    ["multi_agent_owner", 10],
  ];
  for (const [flag, penalty] of cases) {
    assert.equal(applySybilPenalty(100, [flag]), 100 - penalty, flag);
  }
});

test("sybil penalties stack and floor at zero", () => {
  assert.equal(
    applySybilPenalty(100, ["review_velocity_anomaly", "multi_agent_owner"]),
    75,
  );
  assert.equal(
    applySybilPenalty(30, ["owner_count_unavailable", "funding_cluster", "multi_agent_owner"]),
    0,
  );
  assert.equal(applySybilPenalty(80, []), 80);
  assert.equal(applySybilPenalty(80, ["unknown_future_flag"]), 80, "unknown flags cost nothing");
});

// ---- manual list -----------------------------------------------------------

test("blacklist zeroes the score and forces BLOCK", () => {
  const r = applyManualList(100, "blacklist");
  assert.equal(r.score, 0);
  assert.equal(r.recommendation, "BLOCK");
  assert.equal(r.manualOverride, true);
});

test("blacklist wins even when sybil risk is low", () => {
  assert.equal(applyManualList(100, "blacklist", "low").score, 0);
});

test("whitelist is a floor of 80, never a ceiling", () => {
  assert.equal(applyManualList(10, "whitelist", "low").score, 80);
  assert.equal(applyManualList(95, "whitelist", "low").score, 95, "an already-higher score is kept");
  assert.equal(applyManualList(80, "whitelist", "low").score, 80);
});

test("whitelist does NOT lift a score when sybil risk is anything but low", () => {
  for (const risk of ["medium", "high"] as const) {
    const r = applyManualList(10, "whitelist", risk);
    assert.equal(r.score, 10, `risk ${risk} must not be laundered by a whitelist`);
    assert.equal(r.manualOverride, false);
    assert.equal(r.recommendation, undefined);
  }
});

test("no list leaves the score untouched", () => {
  const r = applyManualList(57, "none");
  assert.equal(r.score, 57);
  assert.equal(r.manualOverride, false);
  assert.equal(r.recommendation, undefined);
});

// ---- wallet matching -------------------------------------------------------

test("wallet comparison is case-insensitive (EIP-55 vs lowercase)", () => {
  const a = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01" as Address;
  assert.equal(walletsMatch(a, a.toLowerCase()), true);
  assert.equal(walletsMatch(a, a.toUpperCase()), true);
});

test("a missing wallet on either side never matches", () => {
  const a = "0x0000000000000000000000000000000000000001" as Address;
  assert.equal(walletsMatch(null, a), false);
  assert.equal(walletsMatch(a, undefined), false);
  assert.equal(walletsMatch(a, ""), false);
  assert.equal(walletsMatch(null, undefined), false);
});

test("different wallets do not match", () => {
  assert.equal(
    walletsMatch(
      "0x0000000000000000000000000000000000000001" as Address,
      "0x0000000000000000000000000000000000000002",
    ),
    false,
  );
});

test("owner_index_stale is a soft -5, and stays soft in the risk model", () => {
  assert.equal(applySybilPenalty(100, ["owner_index_stale"]), 95);
});

// ---- breakdown (N-21 explainability) ---------------------------------------
//
// The breakdown must be a faithful decomposition of the number, never a
// parallel calculation that could drift. Two invariants pin it:
//   - the four contributions sum to weightedSubtotal (same weight arithmetic
//     as computeWeightedScore, so the explanation adds up to the score);
//   - sybilPenalty is recovered as prePolicyScore − weightedSubtotal, so it
//     equals what applySybilPenalty actually removed and cannot disagree.

test("breakdown: contributions sum to the weighted subtotal", () => {
  const b = buildScoreBreakdown({ identity: 100, reputation: 80, wallet: 75, x402: 50 });
  const sum =
    b.components.identity.contribution +
    b.components.reputation.contribution +
    b.components.wallet.contribution +
    b.components.x402.contribution;
  // rounding is per-contribution (2 dp), so allow a small tolerance vs subtotal
  assert.ok(Math.abs(sum - b.weightedSubtotal) < 1, `${sum} vs ${b.weightedSubtotal}`);
});

test("breakdown: weightedSubtotal matches computeWeightedScore exactly", () => {
  const c = { identity: 60, reputation: 45, wallet: 55, x402: 50 };
  const b = buildScoreBreakdown(c);
  assert.equal(
    b.weightedSubtotal,
    computeWeightedScore(c.identity, c.reputation, c.wallet, c.x402),
  );
});

test("breakdown: component weights mirror SCORE_WEIGHTS", () => {
  const b = buildScoreBreakdown({ identity: 0, reputation: 0, wallet: 0, x402: 0 });
  assert.equal(b.components.identity.weight, SCORE_WEIGHTS.identity);
  assert.equal(b.components.reputation.weight, SCORE_WEIGHTS.reputation);
  assert.equal(b.components.wallet.weight, SCORE_WEIGHTS.wallet);
  assert.equal(b.components.x402.weight, SCORE_WEIGHTS.x402);
});

test("breakdown: sybilPenalty is exactly prePolicyScore − weightedSubtotal", () => {
  const c = { identity: 100, reputation: 80, wallet: 75, x402: 50 };
  const subtotal = computeWeightedScore(c.identity, c.reputation, c.wallet, c.x402);
  // engine would pass a pre-policy score already lowered by applySybilPenalty
  const pre = applySybilPenalty(subtotal, ["funding_cluster"]); // −20
  const b = buildScoreBreakdown(c, pre);
  assert.equal(b.prePolicyScore, pre);
  assert.equal(b.sybilPenalty, pre - subtotal);
  assert.ok(b.sybilPenalty <= 0, "a penalty never adds points");
});

test("breakdown: no penalty when prePolicyScore omitted (subtotal is the score)", () => {
  const b = buildScoreBreakdown({ identity: 60, reputation: 30, wallet: 50, x402: 50 });
  assert.equal(b.sybilPenalty, 0);
  assert.equal(b.prePolicyScore, b.weightedSubtotal);
});
