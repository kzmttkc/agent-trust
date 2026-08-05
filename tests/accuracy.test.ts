// ============================================================
// Vouch — accuracy report arithmetic.
//
// The numbers this module produces go straight onto a PUBLIC page and into
// marketing claims ("N% of our ALLOW verdicts later went bad"). A sign error
// or an off-by-one here is not a bug, it is a false public statement. So the
// rules under test are the honesty rules themselves:
//   - neutral outcomes never move a rate,
//   - conflicts resolve partner-over-auto and bad-over-good (against us),
//   - no rate is published below the minimum sample,
//   - the unflattering number (BLOCK false positives) is computed with the
//     same machinery as the flattering one.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_SAMPLE,
  classifyOutcome,
  computeAccuracyReport,
  type AccuracyRow,
} from "@/lib/scoring/accuracy";

let seq = 0;
function row(over: Partial<AccuracyRow>): AccuracyRow {
  return {
    trustEventId: over.trustEventId ?? `ev-${seq++}`,
    recommendation: "ALLOW",
    outcomeType: "sustained_healthy_activity",
    source: "auto",
    detectedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

/** n distinct verdicts with the given outcome/recommendation. */
function batch(n: number, over: Partial<AccuracyRow>): AccuracyRow[] {
  return Array.from({ length: n }, () => row({ ...over, trustEventId: `ev-${seq++}` }));
}

test("classification: every documented outcome type has an explicit class", () => {
  assert.equal(classifyOutcome("rug_pull_outflow"), "bad");
  assert.equal(classifyOutcome("reputation_negative_feedback"), "bad");
  assert.equal(classifyOutcome("confirmed_fraud"), "bad");
  assert.equal(classifyOutcome("chargeback_dispute"), "bad");
  assert.equal(classifyOutcome("sustained_healthy_activity"), "good");
  assert.equal(classifyOutcome("confirmed_legitimate"), "good");
  assert.equal(classifyOutcome("wallet_dormant"), "neutral");
  assert.equal(classifyOutcome("ownership_changed"), "neutral");
  assert.equal(classifyOutcome("other"), "neutral");
});

test("an unknown future outcome type is neutral, never good or bad", () => {
  assert.equal(classifyOutcome("some_new_type"), "neutral");
});

test("empty input produces an honest empty report, not a crash", () => {
  const r = computeAccuracyReport([]);
  assert.equal(r.observedVerdicts, 0);
  assert.equal(r.resolvedVerdicts, 0);
  assert.equal(r.allowAdverseRate, null);
  assert.equal(r.blockFalsePositiveRate, null);
});

test("rates are null below the minimum sample — noise is never published", () => {
  const r = computeAccuracyReport(batch(MIN_SAMPLE - 1, { outcomeType: "rug_pull_outflow" }));
  assert.equal(r.resolvedVerdicts, MIN_SAMPLE - 1);
  assert.equal(r.allowAdverseRate, null, "8 events must not produce a public rate");
});

test("at the minimum sample the rate is published", () => {
  const rows = [
    ...batch(MIN_SAMPLE - 2, { outcomeType: "sustained_healthy_activity" }),
    ...batch(2, { outcomeType: "rug_pull_outflow" }),
  ];
  const r = computeAccuracyReport(rows);
  assert.equal(r.allowAdverseRate, 20); // 2/10
});

test("neutral outcomes are counted but never move a rate", () => {
  const rows = [
    ...batch(MIN_SAMPLE, { outcomeType: "sustained_healthy_activity" }),
    ...batch(50, { outcomeType: "wallet_dormant" }),
  ];
  const r = computeAccuracyReport(rows);
  assert.equal(r.observedVerdicts, MIN_SAMPLE + 50);
  assert.equal(r.neutralOnlyVerdicts, 50);
  assert.equal(r.resolvedVerdicts, MIN_SAMPLE);
  assert.equal(r.allowAdverseRate, 0, "50 dormant wallets must not dilute the adverse rate");
});

test("conflict: bad beats good within the same source tier (ties count against us)", () => {
  const rows = [
    row({ trustEventId: "dup", outcomeType: "sustained_healthy_activity" }),
    row({ trustEventId: "dup", outcomeType: "rug_pull_outflow" }),
    ...batch(MIN_SAMPLE - 1, { outcomeType: "sustained_healthy_activity" }),
  ];
  const r = computeAccuracyReport(rows);
  assert.equal(r.byRecommendation[0].wentBad, 1);
  assert.equal(r.byRecommendation[0].resolved, MIN_SAMPLE);
});

test("conflict: a partner confirmation overrides auto detection in BOTH directions", () => {
  // auto said bad, partner confirmed legitimate → good wins
  const cleared = computeAccuracyReport([
    row({ trustEventId: "a", outcomeType: "rug_pull_outflow", source: "auto" }),
    row({ trustEventId: "a", outcomeType: "confirmed_legitimate", source: "partner:k1" }),
    ...batch(MIN_SAMPLE - 1, { outcomeType: "sustained_healthy_activity" }),
  ]);
  assert.equal(cleared.byRecommendation[0].wentBad, 0, "partner clearance must override auto bad");

  // auto said good, partner confirmed fraud → bad wins
  const convicted = computeAccuracyReport([
    row({ trustEventId: "b", outcomeType: "sustained_healthy_activity", source: "auto" }),
    row({ trustEventId: "b", outcomeType: "confirmed_fraud", source: "partner:k1" }),
    ...batch(MIN_SAMPLE - 1, { outcomeType: "sustained_healthy_activity" }),
  ]);
  assert.equal(convicted.byRecommendation[0].wentBad, 1);
});

test("partner-bad beats partner-good (the worst credible outcome stands)", () => {
  const r = computeAccuracyReport([
    row({ trustEventId: "c", outcomeType: "confirmed_legitimate", source: "partner:k1" }),
    row({ trustEventId: "c", outcomeType: "confirmed_fraud", source: "partner:k2" }),
    ...batch(MIN_SAMPLE - 1, { outcomeType: "sustained_healthy_activity" }),
  ]);
  assert.equal(r.byRecommendation[0].wentBad, 1);
});

test("the BLOCK false-positive rate counts confirmed-good BLOCKs against us", () => {
  const rows = [
    ...batch(7, { recommendation: "BLOCK", outcomeType: "rug_pull_outflow" }),
    ...batch(3, { recommendation: "BLOCK", outcomeType: "confirmed_legitimate", source: "partner:k1" }),
  ];
  const r = computeAccuracyReport(rows);
  const block = r.byRecommendation.find((b) => b.recommendation === "BLOCK")!;
  assert.equal(block.resolved, 10);
  assert.equal(r.blockFalsePositiveRate, 30); // 3/10 blocked agents were actually fine
});

test("verdicts are bucketed by their own recommendation, not pooled", () => {
  const rows = [
    ...batch(MIN_SAMPLE, { recommendation: "ALLOW", outcomeType: "sustained_healthy_activity" }),
    ...batch(MIN_SAMPLE, { recommendation: "WARN", outcomeType: "rug_pull_outflow" }),
  ];
  const r = computeAccuracyReport(rows);
  assert.equal(r.allowAdverseRate, 0);
  const warn = r.byRecommendation.find((b) => b.recommendation === "WARN")!;
  assert.equal(warn.adverseRate, 100);
});

test("a verdict with an unknown recommendation resolves but joins no bucket", () => {
  const r = computeAccuracyReport([
    row({ recommendation: null, outcomeType: "rug_pull_outflow" }),
    row({ recommendation: "weird", outcomeType: "rug_pull_outflow" }),
  ]);
  assert.equal(r.resolvedVerdicts, 2);
  assert.equal(
    r.byRecommendation.reduce((a, b) => a + b.resolved, 0),
    0,
  );
});

test("partner-reported verdicts are counted once per verdict", () => {
  const r = computeAccuracyReport([
    row({ trustEventId: "p", outcomeType: "confirmed_fraud", source: "partner:k1" }),
    row({ trustEventId: "p", outcomeType: "chargeback_dispute", source: "partner:k1" }),
  ]);
  assert.equal(r.partnerReportedVerdicts, 1);
});

test("rates are rounded to one decimal place", () => {
  const rows = [
    ...batch(1, { outcomeType: "rug_pull_outflow" }),
    ...batch(11, { outcomeType: "sustained_healthy_activity" }),
  ];
  const r = computeAccuracyReport(rows);
  assert.equal(r.allowAdverseRate, 8.3); // 1/12 = 8.333…
});
