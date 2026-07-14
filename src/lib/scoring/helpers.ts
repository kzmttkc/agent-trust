import type { Address } from "viem";
import { SCORE_THRESHOLDS, SCORE_WEIGHTS } from "@/lib/chain/config";
import type { Recommendation } from "./types";

export function toRecommendation(score: number, isBlacklisted: boolean): Recommendation {
  if (isBlacklisted || score < SCORE_THRESHOLDS.warn) return "BLOCK";
  if (score < SCORE_THRESHOLDS.allow) return "WARN";
  return "ALLOW";
}

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
 * Weighted chain score. Missing x402 history scores near-neutral (50) so
 * wallets without settlement attestations are not harshly penalized while the
 * network is bootstrapping.
 */
export function scoreX402Payments(params: {
  paymentCount: number;
  uniqueDays: number;
}): number {
  if (params.paymentCount <= 0) return 50;

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

export function applySybilPenalty(baseScore: number, flags: string[]): number {
  let score = baseScore;
  if (flags.includes("review_velocity_anomaly")) score -= 15;
  if (flags.includes("feedback_stats_unavailable")) score -= 15;
  if (flags.includes("reputation_summary_unavailable")) score -= 20;
  if (flags.includes("owner_count_unavailable")) score -= 25;
  if (flags.includes("wallet_metrics_unavailable")) score -= 20;
  if (flags.includes("funding_cluster")) score -= 20;
  if (flags.includes("multi_agent_owner")) score -= 10;
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
