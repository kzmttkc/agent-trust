import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { scanWatchlist } from "@/lib/watchlist";

// N-15 — the monitoring heartbeat. Same engine, same fail-closed rules as a
// live lookup; webhooks fire only on verdict changes.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  const result = await scanWatchlist(Math.min(500, Math.max(1, limit)));
  return NextResponse.json({ ok: true, ...result });
}
