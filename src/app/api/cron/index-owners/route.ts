import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { isProduction } from "@/lib/config/env";
import { indexOwnerAgents } from "@/lib/indexer/owner-indexer";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Production ignores attacker-controlled maxBlocks (RPC burn); use default chunk.
  // Capped well below the historical 150_000: at ~800 events/100k blocks,
  // registered+transfer DB writes plus RPC fetch time exceeded the 300s
  // function budget (2026-07-22 FUNCTION_INVOCATION_TIMEOUT incident).
  // vercel.json cron cadence stays daily (Vercel Hobby plan caps cron jobs
  // at once/day), so 40k/run is slightly below Base's ~43k blocks/day
  // production rate — catch-up needs either an occasional manual invoke
  // (Authorization: Bearer $CRON_SECRET) or a plan upgrade for hourly cron.
  const raw = request.nextUrl.searchParams.get("maxBlocks");
  const requested = raw ? Number(raw) : 40_000;
  const maxBlocks = isProduction()
    ? 40_000
    : Math.min(500_000, Math.max(1_000, Number.isFinite(requested) ? requested : 40_000));

  const result = await indexOwnerAgents({
    maxBlocks: BigInt(maxBlocks),
  });

  return NextResponse.json({ ok: true, ...result });
}
