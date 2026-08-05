// ============================================================
// Vouch — the fail-closed chain, end to end.
//
// WHY THIS IS THE FIRST TEST FILE IN THE PRODUCT (2026-08-05). Every external
// read the engine makes is wrapped so that a failure becomes a `*_unavailable`
// flag rather than an exception. assessSybilRisk maps any of those to
// risk="high", and resolveRecommendation turns "high" into an unconditional
// BLOCK. That is the entire safety property of a trust API: "we could not
// check" must never leave here as "we checked and it was fine".
//
// It is also the property most likely to break without anyone noticing,
// because breaking it does not throw — it produces a confident ALLOW. A
// customer gating x402 settlement on this endpoint would keep settling
// payments while our RPC was down, and the first symptom would be their loss,
// not our alert.
//
// Run: npm test
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessSybilRisk,
  resolveRecommendation,
  toRecommendation,
} from "@/lib/scoring/verdict";
import { SCORE_THRESHOLDS } from "@/lib/chain/config";

const UNAVAILABLE_FLAGS = [
  "owner_count_unavailable",
  "feedback_stats_unavailable",
  "reputation_summary_unavailable",
  "wallet_metrics_unavailable",
] as const;

test("every unavailable flag on its own is high risk", () => {
  for (const flag of UNAVAILABLE_FLAGS) {
    assert.equal(assessSybilRisk([flag]), "high", `${flag} must be high`);
  }
});

test("a failed or mismatched wallet verification is high risk", () => {
  assert.equal(assessSybilRisk(["wallet_mismatch"]), "high");
  assert.equal(assessSybilRisk(["wallet_verification_failed"]), "high");
});

test("no flags is low risk — the only way to reach ALLOW", () => {
  assert.equal(assessSybilRisk([]), "low");
});

test("a single soft flag is medium, not high", () => {
  assert.equal(assessSybilRisk(["new_burner_wallet"]), "medium");
  assert.equal(assessSybilRisk(["multi_agent_owner"]), "medium");
  assert.equal(assessSybilRisk(["funding_cluster"]), "medium");
  assert.equal(assessSybilRisk(["review_velocity_anomaly"]), "medium");
  assert.equal(assessSybilRisk(["no_bound_wallet"]), "medium");
});

test("three soft flags together are high", () => {
  assert.equal(
    assessSybilRisk(["new_burner_wallet", "multi_agent_owner", "no_bound_wallet"]),
    "high",
  );
  assert.equal(assessSybilRisk(["new_burner_wallet", "multi_agent_owner"]), "medium");
});

test("the two named soft-flag pairs are high", () => {
  assert.equal(assessSybilRisk(["funding_cluster", "multi_agent_owner"]), "high");
  assert.equal(assessSybilRisk(["no_bound_wallet", "review_velocity_anomaly"]), "high");
});

test("an unknown future flag counts toward the >=3 rule but never clears risk", () => {
  assert.equal(assessSybilRisk(["something_new"]), "medium");
  assert.equal(assessSybilRisk(["a", "b", "c"]), "high");
  // An unavailable flag stays decisive no matter what else is present.
  assert.equal(assessSybilRisk(["a", "feedback_stats_unavailable"]), "high");
});

// ---- the gate itself -------------------------------------------------------

test("high risk BLOCKs at every score, including a perfect one", () => {
  for (const score of [0, 39, 40, 69, 70, 99, 100]) {
    assert.equal(
      resolveRecommendation(score, "none", "high"),
      "BLOCK",
      `score ${score} must BLOCK when sybil risk is high`,
    );
  }
});

test("a whitelist cannot rescue a high-risk agent", () => {
  assert.equal(resolveRecommendation(100, "whitelist", "high"), "BLOCK");
  assert.equal(resolveRecommendation(85, "whitelist", "high"), "BLOCK");
});

test("every unavailable flag ends in BLOCK through the real chain", () => {
  for (const flag of UNAVAILABLE_FLAGS) {
    const risk = assessSybilRisk([flag]);
    assert.equal(
      resolveRecommendation(100, "whitelist", risk),
      "BLOCK",
      `${flag} must not clear an x402 gate`,
    );
  }
});

test("thresholds: ALLOW at 70, WARN at 40, BLOCK below", () => {
  assert.equal(resolveRecommendation(SCORE_THRESHOLDS.allow, "none", "low"), "ALLOW");
  assert.equal(resolveRecommendation(SCORE_THRESHOLDS.allow - 1, "none", "low"), "WARN");
  assert.equal(resolveRecommendation(SCORE_THRESHOLDS.warn, "none", "low"), "WARN");
  assert.equal(resolveRecommendation(SCORE_THRESHOLDS.warn - 1, "none", "low"), "BLOCK");
  assert.equal(resolveRecommendation(0, "none", "low"), "BLOCK");
});

test("a whitelist promotes WARN to ALLOW only when risk is low", () => {
  assert.equal(resolveRecommendation(50, "whitelist", "low"), "ALLOW");
  assert.equal(resolveRecommendation(50, "whitelist", "medium"), "WARN");
  assert.equal(resolveRecommendation(50, "none", "low"), "WARN");
});

test("a whitelist never promotes a BLOCK score to ALLOW", () => {
  assert.equal(resolveRecommendation(10, "whitelist", "low"), "BLOCK");
  assert.equal(resolveRecommendation(SCORE_THRESHOLDS.warn - 1, "whitelist", "low"), "BLOCK");
});

test("a blacklist override wins over everything, including a perfect score", () => {
  assert.equal(resolveRecommendation(100, "blacklist", "low", "BLOCK"), "BLOCK");
});

test("an explicit override short-circuits the whole gate", () => {
  // Operator policy is decided upstream; the gate must not re-litigate it.
  assert.equal(resolveRecommendation(0, "none", "high", "ALLOW"), "ALLOW");
  assert.equal(resolveRecommendation(100, "none", "low", "BLOCK"), "BLOCK");
});

test("medium risk does not block on its own — it is a warning, not a verdict", () => {
  assert.equal(resolveRecommendation(90, "none", "medium"), "ALLOW");
  assert.equal(resolveRecommendation(50, "none", "medium"), "WARN");
});

// ---- toRecommendation, the raw threshold function --------------------------

test("toRecommendation: blacklist forces BLOCK regardless of score", () => {
  assert.equal(toRecommendation(100, true), "BLOCK");
  assert.equal(toRecommendation(0, false), "BLOCK");
  assert.equal(toRecommendation(100, false), "ALLOW");
});

test("toRecommendation boundaries are inclusive at the named thresholds", () => {
  assert.equal(toRecommendation(70, false), "ALLOW");
  assert.equal(toRecommendation(69.999, false), "WARN");
  assert.equal(toRecommendation(40, false), "WARN");
  assert.equal(toRecommendation(39.999, false), "BLOCK");
});

test("the published thresholds are the ones the docs quote", () => {
  assert.equal(SCORE_THRESHOLDS.allow, 70);
  assert.equal(SCORE_THRESHOLDS.warn, 40);
});
