import type { AccuracyReport } from "@/lib/scoring/accuracy";

// ============================================================
// N-20 (2026-08-05) — guarantee underwriting, pure module.
//
// The pivot-scale moat: move from "we score payees" to "we stand behind the
// score" — a capped guarantee on ALLOW verdicts. This module answers ONE
// question deterministically: given our measured accuracy, may we offer a
// guarantee at all, and at what cap and premium?
//
// It deliberately underwrites from the SAME AccuracyReport we publish at
// /accuracy — the guarantee cannot be priced off numbers rosier than the
// public ones. No DB, no RPC: pure function of the report, so every quote is
// reproducible from a published report snapshot.
//
// NOT LIVE. Offering a financial guarantee is a business/legal decision
// (approval-queue AQ-016). This module exists so the decision is about
// facts, not vibes: it fails closed until the data earns it.
// ============================================================

/** Resolved-verdict floor before ANY guarantee may be offered. Far above
 *  accuracy's MIN_SAMPLE=10 — a public rate can be published early, but money
 *  must not be staked on 10 observations. */
export const UNDERWRITE_MIN_RESOLVED = 200;

/** Max tolerable measured ALLOW-gone-bad rate. Above this, no offer. */
export const MAX_ALLOW_ADVERSE_RATE = 0.02;

/** Coverage cap grows with evidence: capUsd = min(MAX_CAP, resolved × $1). */
export const CAP_USD_PER_RESOLVED_VERDICT = 1;
export const MAX_CAP_USD = 5_000;

/** Premium = measured loss rate × safety multiple, floored. Expressed as a
 *  fraction of the guaranteed amount per transaction. */
export const PREMIUM_SAFETY_MULTIPLE = 5;
export const PREMIUM_FLOOR = 0.005; // 0.5%

export interface UnderwritingQuote {
  canOffer: boolean;
  /** USD cap per guaranteed transaction (0 when canOffer=false). */
  maxCoverageUsd: number;
  /** Premium as a fraction of guaranteed amount (null when canOffer=false). */
  premiumRate: number | null;
  /** Machine-readable reasons the offer is withheld (empty when offered). */
  blockers: string[];
  /** Inputs echoed for reproducibility. */
  basis: {
    resolvedVerdicts: number;
    allowAdverseRate: number | null;
    methodologyVersion: number;
  };
}

export function underwrite(report: AccuracyReport): UnderwritingQuote {
  const blockers: string[] = [];
  const { resolvedVerdicts, allowAdverseRate } = report;

  if (resolvedVerdicts < UNDERWRITE_MIN_RESOLVED) {
    blockers.push(`insufficient_resolved_verdicts:${resolvedVerdicts}/${UNDERWRITE_MIN_RESOLVED}`);
  }
  // Fail closed on missing data: an unpublishable rate is an unpriceable risk.
  if (allowAdverseRate === null) {
    blockers.push("allow_adverse_rate_unavailable");
  } else if (allowAdverseRate > MAX_ALLOW_ADVERSE_RATE) {
    blockers.push(`allow_adverse_rate_too_high:${allowAdverseRate}`);
  }

  if (blockers.length > 0) {
    return {
      canOffer: false,
      maxCoverageUsd: 0,
      premiumRate: null,
      blockers,
      basis: { resolvedVerdicts, allowAdverseRate, methodologyVersion: report.methodologyVersion },
    };
  }

  const maxCoverageUsd = Math.min(MAX_CAP_USD, resolvedVerdicts * CAP_USD_PER_RESOLVED_VERDICT);
  const premiumRate = Math.max(PREMIUM_FLOOR, (allowAdverseRate as number) * PREMIUM_SAFETY_MULTIPLE);
  return {
    canOffer: true,
    maxCoverageUsd,
    premiumRate,
    blockers: [],
    basis: { resolvedVerdicts, allowAdverseRate, methodologyVersion: report.methodologyVersion },
  };
}
