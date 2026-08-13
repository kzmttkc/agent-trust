// ============================================================
// vet402 2026-08-13 — ALLOW requires verifiable evidence, not self-attestation.
//
// The exploit (measured in production): registering an ERC-8004 identity — one
// Base tx, a few cents, ZERO x402 settlements — reached 83/ALLOW, while real
// unregistered companies (vitalik.eth, Ethereum Foundation, Binance) capped at
// 49/WARN. Registration is the cheapest signal to fake and it was carrying the
// most weight. Two changes close it, and BOTH are tested here:
//   - the weights now correlate forgery-cost with influence (identity .05,
//     reputation .10, wallet .25, x402 .40), so registration alone can no
//     longer weigh its way over the line; and
//   - an explicit gate caps any score with no verifiable evidence at WARN, so
//     the rule holds even if the weights are ever retuned.
//
// "Verifiable evidence" = a signed USDC settlement, feedback from ≥3 distinct
// clients, or an established (≥20 tx, ≥30 day) wallet. ERC-8004 registration
// and a self-attested reputation summary are deliberately NOT on that list.
//
// Run: npm test
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capForVerifiableEvidence,
  computeWeightedScore,
  hasVerifiableEvidence,
  scoreIdentity,
  scoreReputation,
  SELF_ATTESTED_CEILING,
} from "@/lib/scoring/helpers";
import { SCORE_THRESHOLDS } from "@/lib/chain/config";

const NO_EVIDENCE = {
  x402PaymentCount: 0,
  uniqueFeedbackClients: 0,
  walletTxCount: 0,
  walletAgeDays: 0,
};

// ---- the evidence predicate ------------------------------------------------

test("registration alone is not verifiable evidence", () => {
  assert.equal(hasVerifiableEvidence(NO_EVIDENCE), false);
  // A brand-new registered agent: a couple of txs, a few days old, no
  // settlements, no distinct-client feedback. Still not evidence.
  assert.equal(
    hasVerifiableEvidence({ x402PaymentCount: 0, uniqueFeedbackClients: 1, walletTxCount: 3, walletAgeDays: 4 }),
    false,
  );
});

test("a single verified x402 settlement is evidence", () => {
  assert.equal(hasVerifiableEvidence({ ...NO_EVIDENCE, x402PaymentCount: 1 }), true);
});

test("feedback from three distinct clients is evidence; two is not", () => {
  assert.equal(hasVerifiableEvidence({ ...NO_EVIDENCE, uniqueFeedbackClients: 3 }), true);
  assert.equal(hasVerifiableEvidence({ ...NO_EVIDENCE, uniqueFeedbackClients: 2 }), false);
});

test("an established wallet (>=20 tx AND >=30 days) is evidence; either alone is not", () => {
  assert.equal(hasVerifiableEvidence({ ...NO_EVIDENCE, walletTxCount: 20, walletAgeDays: 30 }), true);
  assert.equal(hasVerifiableEvidence({ ...NO_EVIDENCE, walletTxCount: 999, walletAgeDays: 29 }), false);
  assert.equal(hasVerifiableEvidence({ ...NO_EVIDENCE, walletTxCount: 19, walletAgeDays: 999 }), false);
});

// ---- the cap ---------------------------------------------------------------

test("the cap holds a no-evidence score at WARN, and never raises a low one", () => {
  assert.equal(SELF_ATTESTED_CEILING, SCORE_THRESHOLDS.allow - 1);
  assert.equal(capForVerifiableEvidence(85, NO_EVIDENCE), SELF_ATTESTED_CEILING);
  assert.equal(capForVerifiableEvidence(SCORE_THRESHOLDS.allow, NO_EVIDENCE), SELF_ATTESTED_CEILING);
  // A low score is untouched — the cap is a Math.min, never a floor.
  assert.equal(capForVerifiableEvidence(30, NO_EVIDENCE), 30);
});

test("the cap is transparent to a score with evidence", () => {
  const withSettlement = { ...NO_EVIDENCE, x402PaymentCount: 3 };
  assert.equal(capForVerifiableEvidence(85, withSettlement), 85);
  assert.equal(capForVerifiableEvidence(100, withSettlement), 100);
});

// ---- the end-to-end property the operator ruled on -------------------------

test("a registration-only agent cannot be scored ALLOW", () => {
  // The strongest self-attested case: registered WITH metadata (identity 100),
  // a maxed self-reported reputation summary, and a respectable-but-not-
  // established wallet — and, crucially, ZERO x402 settlements and no distinct-
  // client feedback. This is the shape that used to read 83/ALLOW.
  const identity = scoreIdentity(true, true); // 100
  const reputation = scoreReputation(1, 100, 0); // 82, a self-attested summary
  const walletScore = 80; // age 90 (+25) + a handful of txs (+5): high, not established
  const x402 = 50; // no settlement history → bootstrap neutral

  const weighted = computeWeightedScore(identity, reputation, walletScore, x402);
  const gated = capForVerifiableEvidence(weighted, {
    x402PaymentCount: 0,
    uniqueFeedbackClients: 1,
    walletTxCount: 10, // <20 → not an established wallet
    walletAgeDays: 90,
  });

  assert.ok(
    gated < SCORE_THRESHOLDS.allow,
    `registration-only scored ${gated}, must be below ALLOW ${SCORE_THRESHOLDS.allow}`,
  );
});

test("the same agent, once it has a real settlement history, CAN reach ALLOW", () => {
  // Identical identity/reputation, but now with verified USDC settlements and a
  // wallet that actually transacted. Evidence is present, so the gate is
  // transparent and the earned score stands.
  const weighted = computeWeightedScore(
    scoreIdentity(true, true),
    scoreReputation(1, 100, 0),
    95, // age 90 + 100 txs
    95, // 20+ settlements across 14+ days
  );
  const gated = capForVerifiableEvidence(weighted, {
    x402PaymentCount: 20,
    uniqueFeedbackClients: 1,
    walletTxCount: 100,
    walletAgeDays: 90,
  });
  assert.ok(
    gated >= SCORE_THRESHOLDS.allow,
    `a settlement-backed agent scored ${gated}, should reach ALLOW ${SCORE_THRESHOLDS.allow}`,
  );
});
