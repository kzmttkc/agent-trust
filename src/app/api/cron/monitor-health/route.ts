import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { runDeepHealthChecks } from "@/lib/health/deep-checks";

/**
 * Scheduled deep health probe for uptime monitors.
 * Returns 503 only on critical env/DB/RPC failures.
 * Indexer catch-up lag is reported in payload but does NOT force 503
 * (avoids weeks of alert fatigue during backfill).
 */

// 2026-08-22 audit: this was the one cron route with no maxDuration, so it
// silently took the platform default instead of a number anyone had reasoned
// about. 60s, matching purge-logs and metrics-rollup, and derived from what
// runDeepHealthChecks actually does: the checks run one after another — a
// `SELECT 1`, an RPC getBlockNumber, the scoring probe (hard-capped at 7s by
// PROBE_DEADLINE_MS, itself under the engine's 6s budget), then a handful of
// indexer checkpoint reads. Even with every step at its worst that is a
// single-digit number of seconds; 60s is headroom, not a target. It must
// stay well BELOW an uptime monitor's own request timeout, because a health
// check that hangs past the watcher is indistinguishable from an outage.
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await runDeepHealthChecks();
  const statusCode = result.criticalFailure ? 503 : 200;

  return NextResponse.json(
    {
      ok: !result.criticalFailure,
      service: "vouch-trust-api",
      monitor: "deep",
      ...result,
    },
    { status: statusCode },
  );
}
