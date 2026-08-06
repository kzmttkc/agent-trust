import { NextRequest, NextResponse } from "next/server";
import {
  applyRateLimit,
  authenticateApiRequest,
  withRateLimitHeaders,
} from "@/lib/api/guard";
import { isGuaranteeUnderwritingEnabled } from "@/lib/config/env";
import { computeAccuracyReport } from "@/lib/scoring/accuracy";
import { fetchAccuracyRows } from "@/lib/db/outcome-reader";
import { underwrite } from "@/lib/guarantee/underwriting";
import { logServerError } from "@/lib/util/log";

// ============================================================
// N-20 guarantee underwriting — the API RECEPTACLE, OFF by default.
//
// This is the wiring, not the launch. It connects the already-tested pure
// function underwrite() to the same external AccuracyReport the public
// /accuracy page is built from, so that the day the business + legal decision
// lands (approval-queue AQ-016) go-live is `GUARANTEE_UNDERWRITING_ENABLED=true`
// and nothing else. Until then this endpoint 404s exactly as if it did not
// exist — a dormant financial product must not be discoverable, quotable, or
// implied to anyone.
//
// It underwrites off the SAME numbers we publish (fetchAccuracyRows excludes
// the operator-benchmark self-seed at the SQL layer), so a quote can never be
// priced off internal numbers rosier than the public ones. The pure function
// fails closed below 200 resolved verdicts — today it returns canOffer:false
// with machine-readable blockers, which is the honest current answer.
// ============================================================

export async function GET(request: NextRequest) {
  // Gate FIRST, before auth even runs: a disabled feature reveals nothing,
  // not even whether a valid key would have worked.
  if (!isGuaranteeUnderwritingEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.error;

  const limited = await applyRateLimit(auth.ctx, 1);
  if (!limited.ok) return limited.error;

  try {
    const report = computeAccuracyReport(await fetchAccuracyRows(90));
    const quote = underwrite(report);
    return withRateLimitHeaders(
      NextResponse.json({
        ...quote,
        // Echo the disclaimer posture — a quote is not a bound policy.
        disclaimer:
          "Indicative underwriting quote from measured accuracy only. Not a bound guarantee, insurance policy, or offer of coverage; subject to separate terms.",
        generatedAt: new Date().toISOString(),
      }),
      limited.rateLimit,
    );
  } catch (error) {
    logServerError("guarantee_quote", error);
    return NextResponse.json({ error: "guarantee_unavailable" }, { status: 503 });
  }
}
