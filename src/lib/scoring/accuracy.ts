/**
 * Score-accuracy measurement — the reader side of verdict_outcomes.
 *
 * WHY THIS EXISTS (2026-08-05 R&D). The schema comment on verdict_outcomes
 * said it plainly: "This is the foundation for measuring score accuracy
 * later; nothing reads from it yet." Two write paths (auto outcome-detector,
 * partner reports) had been filling a table nobody consumed. Meanwhile the
 * competitive field argues about DIMENSIONS — "7 dimensions", "4 pillars" —
 * and not one vendor publishes what happened AFTER their verdicts. "Of the
 * agents we said ALLOW to, N% later went bad" is a number that can only be
 * produced by having issued verdicts and then watched. It compounds with
 * time, which makes it the one moat a late entrant cannot buy.
 *
 * This module is pure on purpose: classification and aggregation take rows
 * and return numbers, so the arithmetic that ends up in public marketing
 * claims is unit-tested without a database.
 *
 * HONESTY RULES (the same fail-closed spirit as the verdict engine):
 *   - An outcome that does not clearly say "good" or "bad" is NEUTRAL and is
 *     excluded from rates — never silently binned to whichever side helps.
 *   - When one verdict has conflicting outcomes, partner confirmation beats
 *     auto detection, and within the same tier BAD beats GOOD: ties count
 *     against us, not for us.
 *   - Rates are only published with a minimum sample size; below it the
 *     report says "insufficient data", never a rate computed from 3 events.
 */

export type OutcomeClass = "good" | "bad" | "neutral";

/** Every outcome type either write path can produce, classified. Unknown
 *  future types default to neutral — an unclassified event must not move a
 *  published rate in either direction. */
export const OUTCOME_CLASS: Record<string, OutcomeClass> = {
  // auto (outcome-detector)
  rug_pull_outflow: "bad",
  reputation_negative_feedback: "bad",
  sustained_healthy_activity: "good",
  wallet_dormant: "neutral", // silence is not vindication
  ownership_changed: "neutral", // a side-signal, not a verdict on behaviour
  // partner-reported
  confirmed_fraud: "bad",
  chargeback_dispute: "bad",
  confirmed_legitimate: "good",
  other: "neutral",
};

export function classifyOutcome(outcomeType: string): OutcomeClass {
  return OUTCOME_CLASS[outcomeType] ?? "neutral";
}

export interface AccuracyRow {
  trustEventId: string;
  /** the recommendation the verdict carried when it was issued */
  recommendation: string | null;
  outcomeType: string;
  /** 'auto' | 'partner:{apiKeyId}' */
  source: string;
  detectedAt: string | Date | null;
}

export interface RecommendationAccuracy {
  recommendation: "ALLOW" | "WARN" | "BLOCK";
  /** distinct verdicts that have at least one good/bad outcome */
  resolved: number;
  wentBad: number;
  stayedGood: number;
  /** wentBad / resolved, null below MIN_SAMPLE */
  adverseRate: number | null;
}

export interface AccuracyReport {
  /** distinct verdicts with any outcome recorded (incl. neutral-only) */
  observedVerdicts: number;
  /** distinct verdicts whose outcome resolves to good or bad */
  resolvedVerdicts: number;
  neutralOnlyVerdicts: number;
  partnerReportedVerdicts: number;
  byRecommendation: RecommendationAccuracy[];
  /** headline: of ALLOW verdicts with a known outcome, share that went bad */
  allowAdverseRate: number | null;
  /** of BLOCK verdicts with a known outcome, share later confirmed
   *  legitimate — our false-positive signal, published with the same
   *  willingness as the flattering number */
  blockFalsePositiveRate: number | null;
  minSample: number;
  methodologyVersion: 1;
}

/** Below this many resolved verdicts, a rate is statistically noise and is
 *  reported as null. Chosen small enough to start publishing early, large
 *  enough that one event cannot swing a public number by double digits. */
export const MIN_SAMPLE = 10;

interface Resolution {
  cls: OutcomeClass;
  partner: boolean;
  /** precedence rank — higher wins (partner beats auto, bad beats good) */
  rank: number;
}

function rankOf(cls: OutcomeClass, partner: boolean): number {
  // partner-bad(4) > partner-good(3) > auto-bad(2) > auto-good(1); neutral 0
  if (cls === "neutral") return 0;
  return (partner ? 2 : 0) + (cls === "bad" ? 2 : 1);
}

export function computeAccuracyReport(rows: AccuracyRow[]): AccuracyReport {
  // 1. resolve each verdict to one class by precedence
  const byEvent = new Map<string, { resolution: Resolution; recommendation: string | null; sawAny: boolean; sawPartner: boolean }>();
  for (const row of rows) {
    const cls = classifyOutcome(row.outcomeType);
    const partner = row.source.startsWith("partner");
    const rank = rankOf(cls, partner);
    const existing = byEvent.get(row.trustEventId);
    if (!existing) {
      byEvent.set(row.trustEventId, {
        resolution: { cls, partner, rank },
        recommendation: row.recommendation,
        sawAny: true,
        sawPartner: partner,
      });
      continue;
    }
    existing.sawPartner = existing.sawPartner || partner;
    if (rank > existing.resolution.rank) {
      existing.resolution = { cls, partner, rank };
    }
  }

  // 2. aggregate per recommendation
  const buckets: Record<"ALLOW" | "WARN" | "BLOCK", { resolved: number; bad: number; good: number }> = {
    ALLOW: { resolved: 0, bad: 0, good: 0 },
    WARN: { resolved: 0, bad: 0, good: 0 },
    BLOCK: { resolved: 0, bad: 0, good: 0 },
  };
  let resolvedVerdicts = 0;
  let neutralOnly = 0;
  let partnerReported = 0;

  for (const entry of byEvent.values()) {
    if (entry.sawPartner) partnerReported++;
    if (entry.resolution.cls === "neutral") {
      neutralOnly++;
      continue;
    }
    resolvedVerdicts++;
    const rec = entry.recommendation?.toUpperCase();
    if (rec !== "ALLOW" && rec !== "WARN" && rec !== "BLOCK") continue;
    const bucket = buckets[rec];
    bucket.resolved++;
    if (entry.resolution.cls === "bad") bucket.bad++;
    else bucket.good++;
  }

  const rate = (num: number, den: number): number | null =>
    den >= MIN_SAMPLE ? Math.round((num / den) * 1000) / 10 : null;

  const byRecommendation: RecommendationAccuracy[] = (
    ["ALLOW", "WARN", "BLOCK"] as const
  ).map((rec) => ({
    recommendation: rec,
    resolved: buckets[rec].resolved,
    wentBad: buckets[rec].bad,
    stayedGood: buckets[rec].good,
    adverseRate: rate(buckets[rec].bad, buckets[rec].resolved),
  }));

  return {
    observedVerdicts: byEvent.size,
    resolvedVerdicts,
    neutralOnlyVerdicts: neutralOnly,
    partnerReportedVerdicts: partnerReported,
    byRecommendation,
    allowAdverseRate: rate(buckets.ALLOW.bad, buckets.ALLOW.resolved),
    // For BLOCK the "adverse" outcome is the one where we were WRONG: the
    // agent we blocked was later confirmed good.
    blockFalsePositiveRate: rate(buckets.BLOCK.good, buckets.BLOCK.resolved),
    minSample: MIN_SAMPLE,
    methodologyVersion: 1,
  };
}
