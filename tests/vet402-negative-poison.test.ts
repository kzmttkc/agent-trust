// ============================================================
// vet402 2026-08-13 — negative-score poisoning (HIGH-A, R3 backdoor round).
//
// The attack: any free key could BLOCK any payee's PUBLIC score with two
// requests. Score the victim V (mint a trust_event you own, wallet=V), then
// POST confirmed_fraud on your OWN verdict. getOutcomesForWallet(V) returned
// that row, and applyOutcomeAdjustment capped the score at 15 → BLOCK the
// moment ANY negative existed — reporter trust, payment relationship, and
// report count all unchecked. That BLOCK is what the SDK's SpendGuard reads
// before releasing funds, so a competitor's payments stopped.
//
// The fix (this suite drives the pure decision): a negative label caps the
// public score only when it is TRUSTED — auto (chain-observed), a verified
// counterparty (the reporter actually paid the subject), or corroborated by
// enough independent accounts. A lone self-authored partner report is retained
// but UNCORROBORATED, and cannot move the money-facing number.
//
// Run: npm test  (or: npx tsx --test tests/vet402-negative-poison.test.ts)
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import type { WalletOutcomeRow } from "@/lib/db/outcome-writer";
import {
  applyOutcomeAdjustment,
  EMPTY_OUTCOME_TRUST,
  REQUIRED_INDEPENDENT_REPORTERS,
  type OutcomeTrust,
} from "@/lib/scoring/outcome-adjustment";

const CLEAN_SCORE = 82;

function partnerNegative(
  keyId: string,
  outcomeType = "confirmed_fraud",
): WalletOutcomeRow {
  return {
    outcomeType,
    source: `partner:${keyId}`,
    apiKeyId: keyId,
    detectedAt: new Date("2026-08-13T00:00:00Z"),
    evidence: null,
  };
}

function autoOutcome(outcomeType: string): WalletOutcomeRow {
  return {
    outcomeType,
    source: "auto",
    apiKeyId: null,
    detectedAt: new Date("2026-08-13T00:00:00Z"),
    evidence: null,
  };
}

function trust(overrides: Partial<OutcomeTrust> = {}): OutcomeTrust {
  return {
    verifiedCounterparties: overrides.verifiedCounterparties ?? new Set(),
    accountByReporter: overrides.accountByReporter ?? new Map(),
  };
}

// ---- THE ATTACK ------------------------------------------------------------

test("ATTACK: a lone self-authored partner fraud report cannot move the public score", () => {
  const outcomes = [partnerNegative("attacker-free-key")];
  const result = applyOutcomeAdjustment(CLEAN_SCORE, outcomes, EMPTY_OUTCOME_TRUST);

  assert.equal(result.score, CLEAN_SCORE, "the score must be untouched by an unverified single report");
  assert.equal(result.adjustment, 0);
  assert.deepEqual(result.trustedNegativeTypes, [], "nothing about this report is trusted");
  assert.deepEqual(result.uncorroboratedNegativeTypes, ["confirmed_fraud"], "it is retained, not discarded");
});

test("ATTACK: two throwaway keys are still below the corroboration bar", () => {
  // Two distinct anonymous keys (unknown accounts) — the cheapest sybil. Must
  // stay uncorroborated: the bar is REQUIRED_INDEPENDENT_REPORTERS = 3.
  const outcomes = [partnerNegative("throwaway-1"), partnerNegative("throwaway-2")];
  const result = applyOutcomeAdjustment(CLEAN_SCORE, outcomes, EMPTY_OUTCOME_TRUST);
  assert.equal(result.score, CLEAN_SCORE);
  assert.equal(REQUIRED_INDEPENDENT_REPORTERS, 3);
});

test("ATTACK: many keys under ONE account collapse to a single voice", () => {
  // One actor, three api keys, all under account "acct-sybil". Independence is
  // by account, so this is one reporter, not three — stays uncorroborated.
  const outcomes = [
    partnerNegative("key-a"),
    partnerNegative("key-b"),
    partnerNegative("key-c"),
  ];
  const accountByReporter = new Map<string, string | null>([
    ["key-a", "acct-sybil"],
    ["key-b", "acct-sybil"],
    ["key-c", "acct-sybil"],
  ]);
  const result = applyOutcomeAdjustment(CLEAN_SCORE, outcomes, trust({ accountByReporter }));
  assert.equal(result.score, CLEAN_SCORE, "one actor cannot manufacture a crowd from many keys");
  assert.deepEqual(result.uncorroboratedNegativeTypes, ["confirmed_fraud"]);
});

// ---- LEGITIMATE NEGATIVES STILL BITE ---------------------------------------

test("a verified counterparty's single fraud report DOES cap the score", () => {
  const outcomes = [partnerNegative("real-counterparty")];
  const result = applyOutcomeAdjustment(
    CLEAN_SCORE,
    outcomes,
    trust({ verifiedCounterparties: new Set(["real-counterparty"]) }),
  );
  assert.equal(result.score, 15, "a reporter who actually paid the wallet is trusted on its own");
  assert.deepEqual(result.trustedNegativeTypes, ["confirmed_fraud"]);
  assert.deepEqual(result.uncorroboratedNegativeTypes, []);
});

test("REGRESSION: an auto-detected rug_pull_outflow still caps at 15", () => {
  const result = applyOutcomeAdjustment(CLEAN_SCORE, [autoOutcome("rug_pull_outflow")], EMPTY_OUTCOME_TRUST);
  assert.equal(result.score, 15, "chain-observed negatives are trusted, unchanged from before");
  assert.deepEqual(result.trustedNegativeTypes, ["rug_pull_outflow"]);
});

test("three INDEPENDENT accounts corroborate and cap the score", () => {
  const outcomes = [
    partnerNegative("k1"),
    partnerNegative("k2"),
    partnerNegative("k3"),
  ];
  const accountByReporter = new Map<string, string | null>([
    ["k1", "acct-1"],
    ["k2", "acct-2"],
    ["k3", "acct-3"],
  ]);
  const result = applyOutcomeAdjustment(CLEAN_SCORE, outcomes, trust({ accountByReporter }));
  assert.equal(result.score, 15, "three independent accounts is corroboration");
  assert.equal(result.trustedNegativeTypes.includes("confirmed_fraud"), true);
});

test("three distinct anonymous keys (no known account) also corroborate", () => {
  // Unknown-account reporters fall back to per-key independence. Three genuinely
  // distinct keys is still three voices.
  const outcomes = [
    partnerNegative("anon-1"),
    partnerNegative("anon-2"),
    partnerNegative("anon-3"),
  ];
  const result = applyOutcomeAdjustment(CLEAN_SCORE, outcomes, EMPTY_OUTCOME_TRUST);
  assert.equal(result.score, 15);
});

// ---- POSITIVES / MIXTURES --------------------------------------------------

test("REGRESSION: an auto positive still adds +8", () => {
  const result = applyOutcomeAdjustment(70, [autoOutcome("sustained_healthy_activity")], EMPTY_OUTCOME_TRUST);
  assert.equal(result.score, 78);
  assert.deepEqual(result.positiveTypes, ["sustained_healthy_activity"]);
});

test("a trusted negative beats a positive (cap wins)", () => {
  const outcomes = [autoOutcome("sustained_healthy_activity"), autoOutcome("rug_pull_outflow")];
  const result = applyOutcomeAdjustment(90, outcomes, EMPTY_OUTCOME_TRUST);
  assert.equal(result.score, 15, "a real negative outranks a positive");
});

test("an UNCORROBORATED negative does not block a positive from applying", () => {
  // A lone unverified fraud report sits alongside a chain-earned positive. The
  // positive is real, the negative is unproven → +8 applies, negative disclosed.
  const outcomes = [autoOutcome("sustained_healthy_activity"), partnerNegative("lone-key")];
  const result = applyOutcomeAdjustment(70, outcomes, EMPTY_OUTCOME_TRUST);
  assert.equal(result.score, 78, "an unproven accusation cannot cancel earned standing");
  assert.deepEqual(result.uncorroboratedNegativeTypes, ["confirmed_fraud"]);
  assert.deepEqual(result.positiveTypes, ["sustained_healthy_activity"]);
});

test("no outcomes leaves the score exactly as measured", () => {
  const result = applyOutcomeAdjustment(64, [], EMPTY_OUTCOME_TRUST);
  assert.equal(result.score, 64);
  assert.equal(result.adjustment, 0);
  assert.deepEqual(result.types, []);
});

test("a mix of trusted and uncorroborated negatives caps (the trusted one bites)", () => {
  const outcomes = [
    partnerNegative("verified-key", "confirmed_fraud"),
    partnerNegative("random-key", "chargeback_dispute"),
  ];
  const result = applyOutcomeAdjustment(
    80,
    outcomes,
    trust({ verifiedCounterparties: new Set(["verified-key"]) }),
  );
  assert.equal(result.score, 15);
  assert.deepEqual(result.trustedNegativeTypes, ["confirmed_fraud"]);
  assert.deepEqual(result.uncorroboratedNegativeTypes, ["chargeback_dispute"]);
});
