import type { Address } from "viem";
import { SCORE_THRESHOLDS, SCORE_WEIGHTS } from "@/lib/chain/config";
import type { Recommendation, ScoreBreakdown } from "./types";

/**
 * vet402 2026-08-13 — ALLOW requires verifiable on-chain evidence, not just
 * self-attestation.
 *
 * The exploit this closes: registering an ERC-8004 identity (one Base tx, a
 * few cents, ZERO x402 settlements) reached 83/ALLOW, because identity +
 * self-attestable reputation carried half the weight. Rebalancing the weights
 * lowers that, but weights alone cannot state the rule the operator ruled on:
 * "registration may LOWER a score but must never RAISE it above WARN on its
 * own." A high wallet-age score could still push a bare registration over the
 * line. So the gate is explicit and separate from the weights.
 *
 * `hasVerifiableEvidence` is TRUE when at least one signal that an attacker
 * cannot mint for free is present:
 *   - a verified x402 settlement (getX402PaymentStats now counts only USDC
 *     payments whose owner signed for them — the hardest-to-fake signal), OR
 *   - reputation backed by feedback from ≥3 DISTINCT clients (not a self-
 *     attested summary value — distinct reviewers are what the sybil layer
 *     already trusts; a velocity anomaly with few unique clients is flagged
 *     separately), OR
 *   - an established wallet: ≥20 txs AND ≥30 days old (on-chain history that
 *     had to actually accrue over time).
 *
 * ERC-8004 registration and an unbacked reputation summary are deliberately
 * NOT on this list: they are the self-attestation the ruling excludes. When
 * none of the above holds, the engine caps the pre-policy score at
 * SELF_ATTESTED_CEILING (one under the ALLOW line), so the best a self-attested
 * agent can be told is WARN. A customer whitelist can still promote WARN→ALLOW
 * — that is a deliberate OPERATOR decision, not the subject's own claim.
 */
export const SELF_ATTESTED_CEILING = SCORE_THRESHOLDS.allow - 1;

export interface VerifiableEvidenceInputs {
  /** Score-eligible x402 settlements (USDC + amount-verified + owner-signed). */
  x402PaymentCount: number;
  /**
   * vet402 2026-08-14 — L1 delivery-verified observed purchases, the PREMIUM
   * economic-activity signal. Optional so every existing caller keeps compiling;
   * absent means "the observatory recorded none" (the common case today), which
   * is exactly zero evidence from this source, never a free pass.
   */
  l1PurchaseCount?: number;
  /** Distinct clients that left ERC-8004 feedback in the recent window. */
  uniqueFeedbackClients: number;
  walletTxCount: number;
  walletAgeDays: number;
}

export function hasVerifiableEvidence(e: VerifiableEvidenceInputs): boolean {
  // vet402 2026-08-14: a delivery-verified L1 purchase is the strongest evidence
  // vet402 has — it observed the settlement AND confirmed the good was delivered.
  if ((e.l1PurchaseCount ?? 0) > 0) return true;
  if (e.x402PaymentCount > 0) return true;
  if (e.uniqueFeedbackClients >= 3) return true;
  if (e.walletTxCount >= 20 && e.walletAgeDays >= 30) return true;
  return false;
}

/**
 * Apply the ALLOW-evidence gate: a score with no verifiable evidence behind it
 * cannot exceed WARN. Never RAISES a score (it is a Math.min), so a low score
 * with no evidence is untouched — the cap only bites the case the ruling names,
 * a self-attested agent whose weighted score would otherwise clear ALLOW.
 */
export function capForVerifiableEvidence(
  score: number,
  evidence: VerifiableEvidenceInputs,
): number {
  return hasVerifiableEvidence(evidence) ? score : Math.min(score, SELF_ATTESTED_CEILING);
}

// One definition, in the module that has no database import (./verdict).
export { toRecommendation } from "./verdict";

export function normalizeWalletScore(params: {
  ageDays: number;
  txCount: number;
}): { score: number; isBurner: boolean; flags: string[] } {
  const flags: string[] = [];
  const isBurner = params.ageDays < 7 && params.txCount < 5;
  if (isBurner) flags.push("new_burner_wallet");

  let score = 50;
  if (params.ageDays >= 90) score += 25;
  else if (params.ageDays >= 30) score += 15;
  else if (params.ageDays >= 7) score += 5;

  if (params.txCount >= 100) score += 20;
  else if (params.txCount >= 20) score += 10;
  else if (params.txCount >= 5) score += 5;

  if (isBurner) score -= 30;

  return { score: clamp(score), isBurner, flags };
}

export function scoreIdentity(registered: boolean, hasMetadataUri: boolean): number {
  if (!registered) return 0;
  return hasMetadataUri ? 100 : 60;
}

export function scoreReputation(count: number, summaryValue: number, decimals: number): number {
  if (count === 0) return 30;
  const avg = summaryValue / 10 ** decimals;
  const normalized = Math.min(100, Math.max(0, avg));
  const volumeBoost = Math.min(20, count * 2);
  return clamp(normalized * 0.8 + volumeBoost);
}

export function dampenReputationForSybil(reputationScore: number, flags: string[]): number {
  if (
    flags.includes("review_velocity_anomaly") ||
    flags.includes("feedback_stats_unavailable") ||
    flags.includes("reputation_summary_unavailable")
  ) {
    return Math.min(reputationScore, 35);
  }
  return reputationScore;
}

/**
 * x402 axis score. A wallet with ACTUAL settlement history is scored on it;
 * a wallet with NONE gets a low floor, not a neutral 50.
 *
 * vet402 2026-08-13 (score-manipulation ruling, hole 1). x402 is the highest-
 * weighted axis (0.40) precisely because a chain-confirmed, owner-signed USDC
 * settlement is the hardest signal to fake. But `paymentCount <= 0` used to
 * return a neutral 50 — a bootstrap courtesy that made sense at weight 0.10 and
 * became a ~25-raw-point GIFT at 0.40. That gift was the "last push" that
 * carried an agent with ZERO settlements (but a good old wallet + a forged
 * reputation summary) over the ALLOW line: the evidence gate was cleared by the
 * wallet, and the free x402=50 supplied the rest.
 *
 * The ruling: zero settlements must have no power to push a score UP to ALLOW.
 * A no-settlement wallet is not "neutral" on the axis that measures real
 * economic activity — it is empty. `X402_NO_HISTORY_SCORE` is set below 40 so
 * the arithmetic guarantees it: even with identity, reputation and wallet all
 * maxed at 100, a zero-settlement agent tops out at
 * (100·.05 + 100·.10 + 100·.25 + 30·.40) / .80 = 65 → WARN, never ALLOW. It is
 * not zero, so it is not a punitive BLOCK either — a real settlement history is
 * what earns the axis, and its absence simply cannot manufacture ALLOW.
 *
 * A read FAILURE is a different thing and is handled by the caller (the
 * `x402_unavailable` flag), not conflated with "there are none" here.
 */
export const X402_NO_HISTORY_SCORE = 30;

export function scoreX402Payments(params: {
  paymentCount: number;
  uniqueDays: number;
}): number {
  if (params.paymentCount <= 0) return X402_NO_HISTORY_SCORE;

  let score = 55;
  if (params.paymentCount >= 20) score += 30;
  else if (params.paymentCount >= 10) score += 22;
  else if (params.paymentCount >= 5) score += 15;
  else if (params.paymentCount >= 2) score += 8;
  else score += 4;

  if (params.uniqueDays >= 14) score += 10;
  else if (params.uniqueDays >= 7) score += 6;
  else if (params.uniqueDays >= 3) score += 3;

  return clamp(score);
}

/**
 * L1 observed-purchase stats (see src/lib/db/observed-purchases.ts). Every field
 * counts ONLY delivery-verified purchases to independent counterparties.
 *
 * 2026-08-14 (軽 docstring accuracy) — this is NOT "the same shape as x402", and
 * the distinction matters for the trust argument. The soundness of L1 comes from
 * TWO different places, only one of which is a read-time filter:
 *   - DELIVERY is a WRITE-TIME guarantee: `delivery_verified` is set by the
 *     trusted observatory when it records the row (recordObservedPurchase), the
 *     same trust boundary as funder_wallets/feedback_events. It is not, and
 *     cannot be, derived at read time — the reader only trusts the flag.
 *   - Independence/dust are READ-TIME filters, ANALOGOUS to getX402PaymentStats
 *     (self-dealing, sub-dust and funder-shared counterparties are stripped by
 *     the reader) but NOT the identical query: L1 filters on delivery_verified +
 *     its own columns, x402 on owner-signature + ownership_verified. Same intent,
 *     different SQL — see observed-purchases.ts for the exact eligibility.
 */
export type L1PurchaseStats = {
  purchaseCount: number;
  uniqueDays: number;
  distinctCounterparties: number;
};

/**
 * The PREMIUM economic-activity signal: vet402's own delivery-verified observed
 * purchases. It starts well above the x402 curve because it is a strictly
 * stronger fact — vet402 did not merely see a USDC settlement, it confirmed the
 * purchased good/service was actually delivered to an independent seller. A
 * single such purchase is already meaningful (75); breadth across distinct
 * sellers and days lifts it toward 100.
 */
export function scoreL1Purchases(l1: L1PurchaseStats): number {
  if (l1.purchaseCount <= 0) return X402_NO_HISTORY_SCORE;

  let score = 75;
  if (l1.purchaseCount >= 20) score += 10;
  else if (l1.purchaseCount >= 10) score += 7;
  else if (l1.purchaseCount >= 5) score += 5;
  else if (l1.purchaseCount >= 2) score += 3;

  if (l1.distinctCounterparties >= 10) score += 9;
  else if (l1.distinctCounterparties >= 5) score += 6;
  else if (l1.distinctCounterparties >= 2) score += 3;

  if (l1.uniqueDays >= 14) score += 6;
  else if (l1.uniqueDays >= 7) score += 4;
  else if (l1.uniqueDays >= 3) score += 2;

  return clamp(score);
}

/**
 * Payee-side L1 receiving signal (vet402 2026-08-14). The seller twin of
 * scoreL1Purchases: how many INDEPENDENT buyers vet402 confirmed received
 * delivery from this address, over how many days. Premium receiving evidence —
 * vet402 did not merely see USDC arrive, it confirmed real buyers got what they
 * paid for — so it starts at the neutral 50 the x402 receiving axis uses and
 * climbs from there. `distinctBuyers` is already funder-collapsed by the reader
 * (getObservedDeliveryStats), so a single-funder sybil cluster cannot buy it.
 */
export function scoreL1Receiving(l1: {
  deliveryCount: number;
  uniqueDays: number;
  distinctBuyers: number;
}): number {
  if (l1.deliveryCount <= 0) return 50;

  let score = 55;
  if (l1.deliveryCount >= 20) score += 18;
  else if (l1.deliveryCount >= 10) score += 13;
  else if (l1.deliveryCount >= 5) score += 9;
  else if (l1.deliveryCount >= 2) score += 5;
  else score += 2;

  if (l1.distinctBuyers >= 10) score += 18;
  else if (l1.distinctBuyers >= 5) score += 12;
  else if (l1.distinctBuyers >= 2) score += 6;

  if (l1.uniqueDays >= 14) score += 9;
  else if (l1.uniqueDays >= 7) score += 6;
  else if (l1.uniqueDays >= 3) score += 3;

  return clamp(score);
}

/**
 * vet402 2026-08-14 — the highest-weighted axis (0.40), broadened from "x402
 * facilitator settlements only" to VERIFIABLE REAL ECONOMIC ACTIVITY, sourced
 * strongest-first:
 *
 *   1. L1 delivery-verified observed purchases (PREMIUM). 0 rows today; the
 *      intake is designed now (src/lib/db/observed-purchases.ts) so the moment
 *      the observatory writes one, it becomes the strongest ALLOW basis a wallet
 *      can have. L1 STARTS above the x402 curve, so when it is present it
 *      normally dominates — but see the monotonicity note below: we take the
 *      STRONGER of L1 and x402, never L1 alone, so a thick x402 record is never
 *      thrown away by a first thin L1 purchase.
 *   2. x402 owner-signed independent USDC settlements (INTERIM PROXY). The
 *      2026-08-13 anti-manipulation ledger is reused verbatim (getX402PaymentStats
 *      already strips self-sends, dust, unsigned rows and funder-shared payees).
 *   3. Neither → X402_NO_HISTORY_SCORE (30). Because this axis carries 0.40, that
 *      floor is what guarantees registration-only / self-attested / self-dealing-
 *      only wallets top out at WARN no matter how good every other axis is
 *      (see the arithmetic in the SCORE_WEIGHTS note in chain/config.ts). The
 *      broadening adds ALLOW routes for REAL activity; it does not lower this
 *      floor, so no fake gains a route it did not have.
 *
 * MONOTONICITY (中-1, 2026-08-14 double-check). This used to `return
 * scoreL1Purchases(l1)` the instant purchaseCount>0, DISCARDING x402. Because a
 * first L1 purchase scores 75 while a deep x402 history scores up to 95, that
 * unconditional switch could make the axis FALL (95→75) when a positive new fact
 * arrived — enough to flip a buyer ALLOW→WARN. Positive evidence must be
 * monotone non-decreasing, so we take Math.max of the two active signals, exactly
 * as the payee engine already does on its receiving axis (payee-engine.ts:
 * `Math.max(scoreReceiving, scoreL1Receiving)`). L1 still dominates whenever it
 * is the stronger of the two, which is the normal case; it just can no longer
 * subtract.
 */
export function scoreEconomicActivity(inputs: {
  l1: L1PurchaseStats;
  x402: { paymentCount: number; uniqueDays: number };
}): number {
  const hasL1 = inputs.l1.purchaseCount > 0;
  const hasX402 = inputs.x402.paymentCount > 0;
  if (!hasL1 && !hasX402) return X402_NO_HISTORY_SCORE;
  const l1Score = hasL1 ? scoreL1Purchases(inputs.l1) : X402_NO_HISTORY_SCORE;
  const x402Score = hasX402 ? scoreX402Payments(inputs.x402) : X402_NO_HISTORY_SCORE;
  return Math.max(l1Score, x402Score);
}

export function computeWeightedScore(
  identityScore: number,
  reputationScore: number,
  walletScore: number,
  x402Score = 50,
): number {
  const { identity, reputation, wallet, x402 } = SCORE_WEIGHTS;
  const weightSum = identity + reputation + wallet + x402;
  const raw =
    identityScore * identity +
    reputationScore * reputation +
    walletScore * wallet +
    x402Score * x402;
  return clamp(raw / weightSum);
}

/**
 * N-21: assemble the explainability breakdown from the exact inputs the engine
 * fed into computeWeightedScore + applySybilPenalty. Pure so it is unit-tested
 * without a chain: the caller passes the same four component scores it weighted
 * and the same prePolicyScore it derived, and this reconstructs the per-factor
 * contributions. `contribution` uses the identical `score × weight ÷ Σweights`
 * arithmetic as computeWeightedScore, so the four contributions sum (up to
 * rounding) to weightedSubtotal. `sybilPenalty` is recovered as
 * prePolicyScore − weightedSubtotal rather than recomputed, so it can never
 * disagree with the score actually returned.
 */
export function buildScoreBreakdown(
  components: { identity: number; reputation: number; wallet: number; x402: number },
  prePolicyScore?: number,
): ScoreBreakdown {
  const { identity, reputation, wallet, x402 } = SCORE_WEIGHTS;
  const weightSum = identity + reputation + wallet + x402;
  const contrib = (score: number, weight: number) =>
    Math.round((score * weight * 100) / weightSum) / 100;
  const weightedSubtotal = computeWeightedScore(
    components.identity,
    components.reputation,
    components.wallet,
    components.x402,
  );
  // When prePolicyScore is not supplied (test convenience), treat the sybil
  // penalty as zero — the subtotal IS the pre-policy score.
  const pre = prePolicyScore ?? weightedSubtotal;
  return {
    components: {
      identity: { score: components.identity, weight: identity, contribution: contrib(components.identity, identity) },
      reputation: { score: components.reputation, weight: reputation, contribution: contrib(components.reputation, reputation) },
      wallet: { score: components.wallet, weight: wallet, contribution: contrib(components.wallet, wallet) },
      x402: { score: components.x402, weight: x402, contribution: contrib(components.x402, x402) },
    },
    weightedSubtotal,
    // penalty is what the engine actually removed (pre − subtotal), never a
    // recomputation that could drift from applySybilPenalty.
    sybilPenalty: pre - weightedSubtotal,
    prePolicyScore: pre,
  };
}

export function applySybilPenalty(baseScore: number, flags: string[]): number {
  let score = baseScore;
  if (flags.includes("review_velocity_anomaly")) score -= 15;
  if (flags.includes("feedback_stats_unavailable")) score -= 15;
  if (flags.includes("reputation_summary_unavailable")) score -= 20;
  if (flags.includes("owner_count_unavailable")) score -= 25;
  if (flags.includes("wallet_metrics_unavailable")) score -= 20;
  if (flags.includes("funding_cluster")) score -= 20;
  if (flags.includes("multi_agent_owner")) score -= 10;
  // Soft freshness flag (2026-08-05): the owner index lags by more than the
  // staleness threshold, so owner/funding cluster checks may miss the very
  // newest registrations. A modest, honest discount — not an *_unavailable
  // hard-block, because the data is present, just possibly incomplete at
  // the newest edge.
  if (flags.includes("owner_index_stale")) score -= 5;
  return clamp(score);
}

export function applyManualList(
  score: number,
  list: "none" | "whitelist" | "blacklist",
  sybilRisk: "low" | "medium" | "high" = "low",
): { score: number; recommendation?: Recommendation; manualOverride?: boolean } {
  if (list === "blacklist") {
    return { score: 0, recommendation: "BLOCK", manualOverride: true };
  }
  if (list === "whitelist") {
    if (sybilRisk !== "low") {
      return { score, manualOverride: false };
    }
    return { score: Math.max(score, 80), manualOverride: true };
  }
  return { score, manualOverride: false };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function walletsMatch(a: Address | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}
