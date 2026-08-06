import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { runBenchmarkScan } from "@/lib/benchmark/runner";

/**
 * Operator benchmark heartbeat (2026-08-06). WEEKLY on purpose — see
 * vercel.json: the plan's cron frequency ceiling is daily (a 6-hour cron
 * once made deploys fail silently for 9 hours), and ground-truth labels
 * don't move fast enough to justify daily RPC spend on ~40 addresses.
 * Same engine and fail-closed rules as a live lookup; results land in
 * verdict_outcomes under source='operator_benchmark' and surface in the
 * separate "Operator benchmark" section of /accuracy.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitParam) ? limitParam : 100));
  const result = await runBenchmarkScan({ limit });
  return NextResponse.json({ ok: true, ...result });
}
