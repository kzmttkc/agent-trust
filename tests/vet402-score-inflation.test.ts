// ============================================================
// vet402 2026-08-13 — positive-direction (buy-up) holes, R3 score-manipulation
// round, post-main residuals. main (59b09df) rebalanced the weights and added
// the ALLOW-evidence gate, but three ways to BUY an ALLOW survived. Each attack
// build below must fall short of ALLOW (score < 70); each legitimate,
// real-activity subject must still pass.
//
//   hole 1  x402 neutral 50   a 0-settlement agent got a ~25-pt gift at weight
//                             0.40 — the "last push" over ALLOW. Now a low floor.
//   hole 2  x402 self-dealing DUST self-loops / same-cluster A→B manufactured a
//                             settlement history. Now dust + self-send + same-
//                             funder recipients are not score-eligible.
//   hole 3  thin-depth payee  a payee with no receiving track record hit 84/ALLOW
//                             on wallet health alone. Now capped at WARN.
//
// This file drives the PURE arithmetic seams (helpers). hole 2's DB filter is
// exercised in vet402-x402-self-dealing.test.ts; hole 3's engine cap in
// tests/payee-fail-closed.test.ts (the thin WALLET now lands WARN, not ALLOW).
//
// Run: npm test
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capForVerifiableEvidence,
  computeWeightedScore,
  scoreX402Payments,
  X402_NO_HISTORY_SCORE,
} from "@/lib/scoring/helpers";
import { SCORE_THRESHOLDS } from "@/lib/chain/config";

/** The end-to-end seller score for an agent, as the engine assembles it:
 *  cap(weighted(identity, reputation, wallet, x402), evidence). */
function agentScore(input: {
  identity: number;
  reputation: number;
  wallet: number;
  x402PaymentCount: number;
  x402UniqueDays?: number;
  uniqueFeedbackClients?: number;
  walletTxCount: number;
  walletAgeDays: number;
}): number {
  const x402 = scoreX402Payments({
    paymentCount: input.x402PaymentCount,
    uniqueDays: input.x402UniqueDays ?? 0,
  });
  const weighted = computeWeightedScore(input.identity, input.reputation, input.wallet, x402);
  return capForVerifiableEvidence(weighted, {
    x402PaymentCount: input.x402PaymentCount,
    uniqueFeedbackClients: input.uniqueFeedbackClients ?? 0,
    walletTxCount: input.walletTxCount,
    walletAgeDays: input.walletAgeDays,
  });
}

// ---- hole 1: the x402 neutral-50 gift --------------------------------------

test("ATTACK T-1: good old wallet + forged reputation, ZERO settlements < ALLOW", () => {
  // The doc's build B: id100 rep92 wal95, 0 settlements. Reached 72/ALLOW on
  // main because x402=50 supplied the last push. The established wallet clears
  // the evidence gate, so the ONLY thing keeping it out of ALLOW now is that a
  // zero-settlement x402 axis no longer gifts a neutral 50.
  const score = agentScore({
    identity: 100,
    reputation: 92,
    wallet: 95,
    x402PaymentCount: 0,
    walletTxCount: 100, // established → evidence gate transparent
    walletAgeDays: 90,
  });
  assert.ok(score < SCORE_THRESHOLDS.allow, `build B scored ${score}, must be below ALLOW`);
});

test("a zero-settlement agent cannot reach ALLOW no matter how high the other axes", () => {
  const score = agentScore({
    identity: 100,
    reputation: 100,
    wallet: 100,
    x402PaymentCount: 0,
    uniqueFeedbackClients: 3, // clears the gate a different way
    walletTxCount: 100,
    walletAgeDays: 365,
  });
  assert.ok(score < SCORE_THRESHOLDS.allow, `maxed-but-unsettled scored ${score}`);
  assert.equal(scoreX402Payments({ paymentCount: 0, uniqueDays: 0 }), X402_NO_HISTORY_SCORE);
});

// ---- the legitimate path still passes --------------------------------------

test("a settlement-backed agent still reaches ALLOW", () => {
  // Real, independent, non-dust settlements (paymentCount reflects what the DB
  // filter in hole 2 actually counted): the axis earns its weight honestly.
  const score = agentScore({
    identity: 100,
    reputation: 82,
    wallet: 95,
    x402PaymentCount: 20,
    x402UniqueDays: 14,
    walletTxCount: 100,
    walletAgeDays: 90,
  });
  assert.ok(score >= SCORE_THRESHOLDS.allow, `a real settlement history scored ${score}, should ALLOW`);
});

test("hole 1 does not push an otherwise-mediocre honest agent below WARN into BLOCK gratuitously", () => {
  // A registered agent with a decent established wallet and no settlements: it
  // should sit in WARN (the honest 'not yet proven' band), not be slammed to
  // BLOCK. This guards the low floor from becoming a punitive one.
  const score = agentScore({
    identity: 100,
    reputation: 30,
    wallet: 85,
    x402PaymentCount: 0,
    walletTxCount: 40,
    walletAgeDays: 120,
  });
  assert.ok(score >= SCORE_THRESHOLDS.warn, `honest unsettled agent scored ${score}, should stay >= WARN`);
  assert.ok(score < SCORE_THRESHOLDS.allow, `and still below ALLOW (${score}) — no settlements`);
});
