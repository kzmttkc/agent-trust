// ============================================================
// vet402 2026-08-14 — the premium axis is "verifiable economic activity", not
// "x402 facilitator settlements only".
//
// Blocker (measured): the engine could put NOBODY on ALLOW. With
// X402_NO_HISTORY_SCORE=30 at weight 0.40, a wallet with zero x402 settlements
// caps at 65/WARN no matter how good every other axis is — and because real
// x402 facilitator activity does not exist in the economy yet, EVERY genuine
// wallet was pinned to WARN, so an allow-only default stopped every settlement.
//
// The fix broadens the highest-weighted axis to accept verifiable REAL economic
// activity, strongest-first, WITHOUT weakening the anti-manipulation gate:
//   1. L1 — vet402's own delivery-verified observed purchases (the premium
//      signal; 0 rows today, its intake is designed now so it becomes the
//      strongest ALLOW basis the moment the observatory writes one), then
//      x402 owner-signed independent settlements (the interim proxy).
//   2. "no verifiable economic activity" still floors the axis at 30, so
//      registration-only / self-attested / self-dealing-only stay WARN-capped.
//
// These are the PURE tests. The DB readers (getObservedPurchaseStats) and the
// engine wiring are covered in the .pg and engine tests.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreEconomicActivity,
  scoreL1Purchases,
  scoreL1Receiving,
  scoreX402Payments,
  X402_NO_HISTORY_SCORE,
  hasVerifiableEvidence,
  computeWeightedScore,
  capForVerifiableEvidence,
  scoreIdentity,
} from "@/lib/scoring/helpers";
import { SCORE_THRESHOLDS } from "@/lib/chain/config";

const NO_L1 = { purchaseCount: 0, uniqueDays: 0, distinctCounterparties: 0 };
const NO_X402 = { paymentCount: 0, uniqueDays: 0 };

// ---- the axis score --------------------------------------------------------

test("no economic activity of any kind floors the axis at X402_NO_HISTORY_SCORE", () => {
  assert.equal(scoreEconomicActivity({ l1: NO_L1, x402: NO_X402 }), X402_NO_HISTORY_SCORE);
});

test("x402 independent settlements (no L1) score exactly as scoreX402Payments — the interim proxy is unchanged", () => {
  const x402 = { paymentCount: 10, uniqueDays: 7 };
  assert.equal(
    scoreEconomicActivity({ l1: NO_L1, x402 }),
    scoreX402Payments(x402),
  );
});

test("L1 delivery-verified purchases are the PREMIUM signal — a single one already outscores a lone x402 settlement", () => {
  const oneL1 = scoreEconomicActivity({
    l1: { purchaseCount: 1, uniqueDays: 1, distinctCounterparties: 1 },
    x402: NO_X402,
  });
  const oneX402 = scoreX402Payments({ paymentCount: 1, uniqueDays: 1 });
  assert.ok(oneL1 > oneX402, `L1 ${oneL1} should outscore x402 ${oneX402}`);
  assert.ok(oneL1 >= 75, `a delivery-verified L1 purchase should be a strong signal, got ${oneL1}`);
});

test("L1 dominates when both are present — the premium signal is never dragged down by the proxy", () => {
  const both = scoreEconomicActivity({
    l1: { purchaseCount: 5, uniqueDays: 5, distinctCounterparties: 4 },
    x402: { paymentCount: 1, uniqueDays: 1 },
  });
  const l1Only = scoreEconomicActivity({
    l1: { purchaseCount: 5, uniqueDays: 5, distinctCounterparties: 4 },
    x402: NO_X402,
  });
  assert.equal(both, l1Only, "a weak x402 history must not lower a strong L1 score");
});

test("a strong x402 history is NOT dragged down when a first L1 purchase appears (monotonicity)", () => {
  // 中-1 (2026-08-14 double-check): the buyer axis used to UNCONDITIONALLY adopt
  // L1 the moment purchaseCount>0, discarding a thicker x402 record. A wallet
  // with a deep x402 history (95) that then makes its first delivery-verified L1
  // purchase (75) would have its economic-activity axis FALL 95→75 — a positive
  // new fact lowering the score, which can flip ALLOW→WARN. Positive evidence
  // must be monotone non-decreasing: adding a real purchase can never subtract.
  const strongX402 = { paymentCount: 20, uniqueDays: 14 };
  const x402Only = scoreEconomicActivity({ l1: NO_L1, x402: strongX402 });
  const withFirstL1 = scoreEconomicActivity({
    l1: { purchaseCount: 1, uniqueDays: 1, distinctCounterparties: 1 },
    x402: strongX402,
  });
  assert.ok(
    withFirstL1 >= x402Only,
    `a first L1 purchase dropped the axis ${x402Only}→${withFirstL1}; positive evidence must never lower the score`,
  );
  // And it takes the STRONGER of the two, exactly as the payee engine does.
  assert.equal(
    withFirstL1,
    Math.max(scoreX402Payments(strongX402), scoreL1Purchases({ purchaseCount: 1, uniqueDays: 1, distinctCounterparties: 1 })),
  );
});

test("more L1 breadth (distinct counterparties, days) scores higher, and it clamps at 100", () => {
  const thin = scoreEconomicActivity({
    l1: { purchaseCount: 1, uniqueDays: 1, distinctCounterparties: 1 },
    x402: NO_X402,
  });
  const broad = scoreEconomicActivity({
    l1: { purchaseCount: 40, uniqueDays: 30, distinctCounterparties: 25 },
    x402: NO_X402,
  });
  assert.ok(broad > thin, "broader real purchasing history scores higher");
  assert.ok(broad <= 100, "score is clamped");
});

// ---- the evidence gate now recognizes L1 -----------------------------------

test("a delivery-verified L1 purchase is verifiable evidence", () => {
  assert.equal(
    hasVerifiableEvidence({
      x402PaymentCount: 0,
      l1PurchaseCount: 1,
      uniqueFeedbackClients: 0,
      walletTxCount: 0,
      walletAgeDays: 0,
    }),
    true,
  );
});

test("no L1, no x402, no distinct feedback, unestablished wallet is still NOT evidence", () => {
  assert.equal(
    hasVerifiableEvidence({
      x402PaymentCount: 0,
      l1PurchaseCount: 0,
      uniqueFeedbackClients: 1,
      walletTxCount: 3,
      walletAgeDays: 4,
    }),
    false,
  );
});

// ---- end-to-end: real L1 activity reaches ALLOW; the fake stays WARN --------

test("REAL: an established wallet with L1-observed purchases reaches ALLOW", () => {
  // Unregistered real company shape: identity/reputation default low (30/30),
  // established wallet (age 90 + 100 tx = 95), and vet402 has delivery-verified
  // several real purchases it made from independent sellers.
  const ea = scoreEconomicActivity({
    l1: { purchaseCount: 6, uniqueDays: 5, distinctCounterparties: 5 },
    x402: NO_X402,
  });
  const weighted = computeWeightedScore(30, 30, 95, ea);
  const gated = capForVerifiableEvidence(weighted, {
    x402PaymentCount: 0,
    l1PurchaseCount: 6,
    uniqueFeedbackClients: 0,
    walletTxCount: 100,
    walletAgeDays: 90,
  });
  assert.ok(
    gated >= SCORE_THRESHOLDS.allow,
    `L1-backed real wallet scored ${gated}, should reach ALLOW ${SCORE_THRESHOLDS.allow}`,
  );
});

// ---- payee side: L1 deliveries are premium receiving evidence -------------

test("payee L1 receiving: no delivered buyers floors at the neutral receiving score", () => {
  assert.equal(
    scoreL1Receiving({ deliveryCount: 0, uniqueDays: 0, distinctBuyers: 0 }),
    50,
  );
});

test("payee L1 receiving: independent delivered buyers over days score well above neutral", () => {
  const thin = scoreL1Receiving({ deliveryCount: 1, uniqueDays: 1, distinctBuyers: 1 });
  const rich = scoreL1Receiving({ deliveryCount: 12, uniqueDays: 8, distinctBuyers: 6 });
  assert.ok(thin > 50, "even one delivered independent buyer beats the neutral floor");
  assert.ok(rich > thin, "more independent delivered buyers over more days scores higher");
  assert.ok(rich <= 100, "clamped");
});

test("FAKE: registration + maxed self-attested reputation but NO economic activity stays below ALLOW", () => {
  // The shape that used to read 83/ALLOW: identity 100, self-reported reputation,
  // a respectable-but-not-established wallet, and — crucially — no L1, no x402,
  // no distinct-client feedback.
  const ea = scoreEconomicActivity({ l1: NO_L1, x402: NO_X402 }); // 30 floor
  const weighted = computeWeightedScore(scoreIdentity(true, true), 82, 80, ea);
  const gated = capForVerifiableEvidence(weighted, {
    x402PaymentCount: 0,
    l1PurchaseCount: 0,
    uniqueFeedbackClients: 1,
    walletTxCount: 10,
    walletAgeDays: 90,
  });
  assert.ok(
    gated < SCORE_THRESHOLDS.allow,
    `registration-only scored ${gated}, must stay below ALLOW ${SCORE_THRESHOLDS.allow}`,
  );
});
