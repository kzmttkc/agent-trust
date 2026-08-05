/**
 * Pure verdict logic — the two functions that decide whether an x402 payment
 * is allowed to settle.
 *
 * WHY THIS FILE EXISTS (2026-08-05). These two functions used to live in
 * sybil.ts and engine.ts, both of which import the database, the RPC client
 * and the cache at module load. That made the most safety-critical logic in
 * the product the hardest thing in it to test: you could not call
 * assessSybilRisk without a DATABASE_URL. The functions are pure, so they now
 * live somewhere that imports nothing.
 *
 * THE INVARIANT THEY ENFORCE. Every external read that fails is converted by
 * the engine into a `*_unavailable` flag; assessSybilRisk maps any of those to
 * risk = "high"; resolveRecommendation turns "high" into an unconditional
 * BLOCK. That chain is the whole fail-closed design — "we could not check"
 * must never be reported as "we checked and it was fine". It is also the
 * chain most likely to break silently, because breaking it produces a
 * plausible-looking ALLOW rather than an error.
 */
import { SCORE_THRESHOLDS } from "@/lib/chain/config";
import type { Recommendation } from "./types";

export type SybilRisk = "low" | "medium" | "high";
export type ManualList = "none" | "whitelist" | "blacklist";

export function toRecommendation(score: number, isBlacklisted: boolean): Recommendation {
  if (isBlacklisted || score < SCORE_THRESHOLDS.warn) return "BLOCK";
  if (score < SCORE_THRESHOLDS.allow) return "WARN";
  return "ALLOW";
}

export function assessSybilRisk(flags: string[]): SybilRisk {
  if (flags.includes("wallet_mismatch")) return "high";
  if (flags.includes("wallet_verification_failed")) return "high";
  if (flags.includes("owner_count_unavailable")) return "high";
  if (flags.includes("feedback_stats_unavailable")) return "high";
  if (flags.includes("reputation_summary_unavailable")) return "high";
  if (flags.includes("wallet_metrics_unavailable")) return "high";
  if (flags.includes("no_bound_wallet") && flags.includes("review_velocity_anomaly")) {
    return "high";
  }
  if (flags.length >= 3) return "high";
  if (flags.includes("funding_cluster") && flags.includes("multi_agent_owner")) {
    return "high";
  }
  if (flags.length >= 1) return "medium";
  return "low";
}

export function resolveRecommendation(
  trustScore: number,
  effectiveList: ManualList,
  sybilRisk: SybilRisk,
  override?: Recommendation,
): Recommendation {
  if (override) return override;

  // Incomplete or high-risk sybil checks must not clear x402 ALLOW gates.
  if (sybilRisk === "high") {
    return "BLOCK";
  }

  const recommendation = toRecommendation(trustScore, false);
  if (effectiveList === "whitelist" && recommendation === "WARN" && sybilRisk === "low") {
    return "ALLOW";
  }

  return recommendation;
}
