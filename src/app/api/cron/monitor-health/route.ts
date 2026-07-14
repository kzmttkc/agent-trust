import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { runDeepHealthChecks } from "@/lib/health/deep-checks";

/**
 * Scheduled deep health probe for uptime monitors.
 * Returns 503 only on critical env/DB/RPC failures.
 * Indexer catch-up lag is reported in payload but does NOT force 503
 * (avoids weeks of alert fatigue during backfill).
 */
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
